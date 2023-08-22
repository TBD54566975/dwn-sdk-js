import type { EventLog } from '../types/event-log.js';
import type { GenericMessageReply } from '../core/message-reply.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { RecordsWriteMessageWithOptionalEncodedData } from '../store/storage-controller.js';
import type { DataStore, DidResolver, MessageStore } from '../index.js';
import type { RecordsDeleteMessage, RecordsWriteMessage } from '../types/records-types.js';

import { authenticate } from '../core/auth.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { RecordsWrite } from '../interfaces/records-write.js';
import { StorageController } from '../store/storage-controller.js';
import { Cid, DataStream, DwnConstant, Encoder } from '../index.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';

export type RecordsWriteHandlerOptions = {
  skipDataStorage?: boolean; // used for DWN sync
};

type HandlerArgs = { tenant: string, message: RecordsWriteMessage, options?: RecordsWriteHandlerOptions, dataStream?: _Readable.Readable};

export class RecordsWriteHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private messageStore: MessageStore, private dataStore: DataStore, private eventLog: EventLog) { }

  public async handle({
    tenant,
    message,
    options,
    dataStream
  }: HandlerArgs): Promise<GenericMessageReply> {
    let recordsWrite: RecordsWrite;
    try {
      recordsWrite = await RecordsWrite.parse(message);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }

    // authentication & authorization
    try {
      await authenticate(message.authorization, this.didResolver);
      await recordsWrite.authorize(tenant, this.messageStore);
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    // get existing messages matching the `recordId`
    const query = {
      interface : DwnInterfaceName.Records,
      recordId  : message.recordId
    };
    const existingMessages = await this.messageStore.query(tenant, query, {}) as (RecordsWriteMessage|RecordsDeleteMessage)[];

    // if the incoming write is not the initial write, then it must not modify any immutable properties defined by the initial write
    const newMessageIsInitialWrite = await recordsWrite.isInitialWrite();
    if (!newMessageIsInitialWrite) {
      try {
        const initialWrite = await RecordsWrite.getInitialWrite(existingMessages);
        RecordsWrite.verifyEqualityOfImmutableProperties(initialWrite, message);
      } catch (e) {
        return messageReplyFromError(e, 400);
      }
    }

    const newestExistingMessage = await Message.getNewestMessage(existingMessages);

    let incomingMessageIsNewest = false;
    let newestMessage; // keep reference of newest message for pruning later
    if (newestExistingMessage === undefined || await Message.isNewer(message, newestExistingMessage)) {
      incomingMessageIsNewest = true;
      newestMessage = message;
    } else { // existing message is the same age or newer than the incoming message
      newestMessage = newestExistingMessage;
    }

    if (!incomingMessageIsNewest) {
      return {
        status: { code: 409, detail: 'Conflict' }
      };
    }

    const isLatestBaseState = true;
    const indexes = await constructRecordsWriteIndexes(recordsWrite, isLatestBaseState);

    // if data is below a certain threshold, we embed the data directly into the message for storage in MessageStore.
    let messageWithOptionalEncodedData: RecordsWriteMessageWithOptionalEncodedData = message;

    // try to store data, unless options explicitly say to skip storage
    if (options === undefined || !options.skipDataStorage) {
      if (dataStream === undefined && newestExistingMessage?.descriptor.method === DwnMethodName.Delete) {
        return messageReplyFromError(new DwnError(DwnErrorCode.RecordsWriteMissingDataStream, 'No data stream was provided with the previous message being a delete'), 400);
      }

      try {
        // if data is below the threshold, we store it within MessageStore
        if (message.descriptor.dataSize <= DwnConstant.maxDataSizeAllowedToBeEncoded) {
          // processes and sets `encodedData` with appropriate data.
          messageWithOptionalEncodedData = await this.processEncodedData(
            message,
            dataStream,
            newestExistingMessage as (RecordsWriteMessage|RecordsDeleteMessage) | undefined
          );
        } else {
          await this.putData(tenant, message, dataStream);
        }
      } catch (error) {
        const e = error as any;
        if (e.code === DwnErrorCode.RecordsWriteMissingDataInPrevious ||
            e.code === DwnErrorCode.RecordsWriteMissingDataAssociation ||
            e.code === DwnErrorCode.RecordsWriteDataCidMismatch ||
            e.code === DwnErrorCode.RecordsWriteDataSizeMismatch) {
          return messageReplyFromError(error, 400);
        }

        // else throw
        throw error;
      }
    }

    await this.messageStore.put(tenant, messageWithOptionalEncodedData, indexes);
    await this.eventLog.append(tenant, await Message.getCid(message));

    const messageReply = {
      status: { code: 202, detail: 'Accepted' }
    };

    // delete all existing messages that are not newest, except for the initial write
    await StorageController.deleteAllOlderMessagesButKeepInitialWrite(
      tenant, existingMessages, newestMessage, this.messageStore, this.dataStore, this.eventLog
    );

    return messageReply;
  };

  /**
   * Embeds the record's data into the `encodedData` property.
   * If dataStream is present, it uses the dataStream. Otherwise, uses the `encodedData` from the most recent RecordsWrite.
   *
   * @returns {RecordsWriteMessageWithOptionalEncodedData} `encodedData` embedded.
   *
   * @throws {DwnError} with `DwnErrorCode.RecordsWriteMissingDataInPrevious`
   *                    if `dataStream` is absent AND `encodedData` of previous message is missing
   * @throws {DwnError} with `DwnErrorCode.RecordsWriteDataCidMismatch`
   *                    if the data stream resulted in a data CID that mismatches with `dataCid` in the given message
   * @throws {DwnError} with `DwnErrorCode.RecordsWriteDataSizeMismatch`
   *                    if `dataSize` in `descriptor` given mismatches the actual data size
   */
  public async processEncodedData(
    message: RecordsWriteMessage,
    dataStream?: _Readable.Readable,
    newestExistingMessage?: RecordsWriteMessage | RecordsDeleteMessage
  ): Promise<RecordsWriteMessageWithOptionalEncodedData> {
    let dataBytes;
    if (dataStream === undefined) {
      const newestWithData = newestExistingMessage as RecordsWriteMessageWithOptionalEncodedData | undefined;
      if (newestWithData?.encodedData === undefined) {
        throw new DwnError(
          DwnErrorCode.RecordsWriteMissingDataInPrevious,
          `No dataStream was provided and unable to get data from previous message`
        );
      } else {
        dataBytes = Encoder.base64UrlToBytes(newestWithData.encodedData);
      }
    } else {
      dataBytes = await DataStream.toBytes(dataStream);
    }

    const dataCid = await Cid.computeDagPbCidFromBytes(dataBytes);
    RecordsWriteHandler.validateDataIntegrity(message.descriptor.dataCid, message.descriptor.dataSize, dataCid, dataBytes.length);

    const recordsWrite: RecordsWriteMessageWithOptionalEncodedData = { ...message };
    recordsWrite.encodedData = Encoder.bytesToBase64Url(dataBytes);
    return recordsWrite;
  }

  /**
   * Puts the given data in storage unless tenant already has that data for the given recordId
   *
   * @throws {DwnError} with `DwnErrorCode.RecordsWriteMissingDataAssociation`
   *                    if `dataStream` is absent AND unable to associate data given `dataCid`
   * @throws {DwnError} with `DwnErrorCode.RecordsWriteDataCidMismatch`
   *                    if the data stream resulted in a data CID that mismatches with `dataCid` in the given message
   * @throws {DwnError} with `DwnErrorCode.RecordsWriteDataSizeMismatch`
   *                    if `dataSize` in `descriptor` given mismatches the actual data size
   */
  public async putData(
    tenant: string,
    message: RecordsWriteMessage,
    dataStream?: _Readable.Readable,
  ): Promise<void> {
    let result: { dataCid: string, dataSize: number };
    const messageCid = await Message.getCid(message);

    if (dataStream === undefined) {
      const associateResult = await this.dataStore.associate(tenant, messageCid, message.descriptor.dataCid);
      if (associateResult === undefined) {
        throw new DwnError(DwnErrorCode.RecordsWriteMissingDataAssociation, `Unable to associate dataCid ${message.descriptor.dataCid} ` +
          `to messageCid ${messageCid} because dataStream was not provided and data was not found in dataStore`);
      }
      result = associateResult;
    } else {
      result = await this.dataStore.put(tenant, messageCid, message.descriptor.dataCid, dataStream);
    }

    try {
      RecordsWriteHandler.validateDataIntegrity(message.descriptor.dataCid, message.descriptor.dataSize, result.dataCid, result.dataSize);
    } catch (error) {
      // delete data and throw error to caller
      await this.dataStore.delete(tenant, messageCid, message.descriptor.dataCid);
      throw error;
    }
  }

  /**
   * Validates the expected `dataCid` and `dataSize` in the descriptor vs the received data.
   *
   * @throws {DwnError} with `DwnErrorCode.RecordsWriteDataCidMismatch`
   *                    if the data stream resulted in a data CID that mismatches with `dataCid` in the given message
   * @throws {DwnError} with `DwnErrorCode.RecordsWriteDataSizeMismatch`
   *                    if `dataSize` in `descriptor` given mismatches the actual data size
   */
  static validateDataIntegrity(
    expectedDataCid: string,
    expectedDataSize: number,
    actualDataCid: string,
    actualDataSize: number
  ): void {
    if (expectedDataCid !== actualDataCid) {
      throw new DwnError(
        DwnErrorCode.RecordsWriteDataCidMismatch,
        `actual data CID ${actualDataCid} does not match dataCid in descriptor: ${expectedDataCid}`
      );
    }
    if (expectedDataSize !== actualDataSize) {
      throw new DwnError(
        DwnErrorCode.RecordsWriteDataSizeMismatch,
        `actual data size ${actualDataSize} bytes does not match dataSize in descriptor: ${expectedDataSize}`
      );
    }
  }

}

export async function constructRecordsWriteIndexes(
  recordsWrite: RecordsWrite,
  isLatestBaseState: boolean
): Promise<Record<string, string>> {
  const message = recordsWrite.message;
  const descriptor = { ...message.descriptor };
  delete descriptor.published; // handle `published` specifically further down

  const indexes: Record<string, any> = {
    ...descriptor,
    isLatestBaseState,
    published : !!message.descriptor.published,
    author    : recordsWrite.author,
    recordId  : message.recordId,
    entryId   : await RecordsWrite.getEntryId(recordsWrite.author, recordsWrite.message.descriptor)
  };

  // add additional indexes to optional values if given
  // TODO: index multi-attesters to be unblocked by #205 - Revisit database interfaces (https://github.com/TBD54566975/dwn-sdk-js/issues/205)
  if (recordsWrite.attesters.length > 0) { indexes.attester = recordsWrite.attesters[0]; }
  if (message.contextId !== undefined) { indexes.contextId = message.contextId; }

  return indexes;
}
