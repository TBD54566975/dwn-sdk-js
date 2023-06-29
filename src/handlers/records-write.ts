import type { EventLog } from '../types/event-log.js';
import type { GenericMessageReply } from '../core/message-reply.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { DataStore, DidResolver, MessageStore } from '../index.js';
import type { RecordsDeleteMessage, RecordsWriteMessage } from '../types/records-types.js';

import { authenticate } from '../core/auth.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { RecordsWrite } from '../interfaces/records-write.js';
import { StorageController } from '../store/storage-controller.js';
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
    const existingMessages = await this.messageStore.query(tenant, query) as (RecordsWriteMessage|RecordsDeleteMessage)[];

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

    try {
      // try to store data, unless options explicitly say to skip storage
      if (options === undefined || !options.skipDataStorage) {
        await this.putData(tenant, message, dataStream, newestExistingMessage as (RecordsWriteMessage|RecordsDeleteMessage) | undefined);
      }
    } catch (error) {
      const e = error as any;
      if (e.code === DwnErrorCode.RecordsWriteMissingDataStream ||
          e.code === DwnErrorCode.RecordsWriteMissingData ||
          e.code === DwnErrorCode.RecordsWriteDataCidMismatch ||
          e.code === DwnErrorCode.RecordsWriteDataSizeMismatch) {
        return messageReplyFromError(error, 400);
      }

      // else throw
      throw error;
    }

    await this.messageStore.put(tenant, message, indexes);
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
   * Puts the given data in storage unless tenant already has that data for the given recordId
   *
   * @throws {DwnError} with `DwnErrorCode.RecordsWriteMissingDataStream`
   *                    if `dataStream` is absent AND the `dataCid` does not match the current data for the given recordId
   * @throws {DwnError} with `DwnErrorCode.RecordsWriteMissingData`
   *                    if `dataStream` is absent AND dataStore does not contain the given `dataCid`
   * @throws {DwnError} with `DwnErrorCode.RecordsWriteDataCidMismatch`
   *                    if the data stream resulted in a data CID that mismatches with `dataCid` in the given message
   * @throws {DwnError} with `DwnErrorCode.RecordsWriteDataSizeMismatch`
   *                    if `dataSize` in `descriptor` given mismatches the actual data size
   */
  public async putData(
    tenant: string,
    message: RecordsWriteMessage,
    dataStream?: _Readable.Readable,
    newestExistingMessage?: RecordsWriteMessage | RecordsDeleteMessage
  ): Promise<void> {
    let result: { dataCid: string, dataSize: number };
    const messageCid = await Message.getCid(message);

    if (dataStream === undefined) {
      // dataStream must be included if message contains a new dataCid
      if (newestExistingMessage?.descriptor.method === DwnMethodName.Delete ||
          newestExistingMessage?.descriptor.dataCid !== message.descriptor.dataCid) {
        throw new DwnError(
          DwnErrorCode.RecordsWriteMissingDataStream,
          'Data stream is not provided.'
        );
      }

      const associateResult = await this.dataStore.associate(tenant, messageCid, message.descriptor.dataCid);
      if (associateResult === undefined) {
        throw new DwnError(DwnErrorCode.RecordsWriteMissingData, `Unable to associate dataCid ${message.descriptor.dataCid} ` +
          `to messageCid ${messageCid} because dataStream was not provided and data was not found in dataStore`);
      }

      result = associateResult;
    } else {
      result = await this.dataStore.put(tenant, messageCid, message.descriptor.dataCid, dataStream);
    }

    // verify that given dataSize matches size of actual data
    if (message.descriptor.dataSize !== result.dataSize) {
      // there is an opportunity to improve here: handle the edge case of if the delete fails...
      await this.dataStore.delete(tenant, messageCid, message.descriptor.dataCid);

      throw new DwnError(
        DwnErrorCode.RecordsWriteDataSizeMismatch,
        `actual data size ${result.dataSize} bytes does not match dataSize in descriptor: ${message.descriptor.dataSize}`
      );
    }

    // verify that given dataCid matches CID of actual data
    if (message.descriptor.dataCid !== result.dataCid) {
      // there is an opportunity to improve here: handle the edge cae of if the delete fails...
      await this.dataStore.delete(tenant, messageCid, message.descriptor.dataCid);

      throw new DwnError(
        DwnErrorCode.RecordsWriteDataCidMismatch,
        `actual data CID ${result.dataCid} does not match dataCid in descriptor: ${message.descriptor.dataCid}`
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
