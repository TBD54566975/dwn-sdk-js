import type { DataStore } from '../types/data-store.js';
import type { DidResolver } from '../did/did-resolver.js';
import type { EventLog } from '../types/event-log.js';
import type { EventStream } from '../types/subscriptions.js';
import type { GenericMessageReply } from '../types/message-types.js';
import type { MessageStore } from '../types//message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { RecordsQueryReplyEntry, RecordsWriteMessage } from '../types/records-types.js';

import { authenticate } from '../core/auth.js';
import { Cid } from '../utils/cid.js';
import { DataStream } from '../utils/data-stream.js';
import { DwnConstant } from '../core/dwn-constant.js';
import { Encoder } from '../utils/encoder.js';
import { GrantAuthorization } from '../core/grant-authorization.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { ProtocolAuthorization } from '../core/protocol-authorization.js';
import { RecordsGrantAuthorization } from '../core/records-grant-authorization.js';
import { RecordsWrite } from '../interfaces/records-write.js';
import { StorageController } from '../store/storage-controller.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

type HandlerArgs = { tenant: string, message: RecordsWriteMessage, dataStream?: _Readable.Readable};

export class RecordsWriteHandler implements MethodHandler {

  constructor(
    private didResolver: DidResolver,
    private messageStore: MessageStore,
    private dataStore: DataStore,
    private eventLog: EventLog,
    private eventStream: EventStream
  ) { }

  public async handle({
    tenant,
    message,
    dataStream
  }: HandlerArgs): Promise<GenericMessageReply> {
    let recordsWrite: RecordsWrite;
    try {
      recordsWrite = await RecordsWrite.parse(message);

      // Protocol record specific validation
      if (message.descriptor.protocol !== undefined) {
        await ProtocolAuthorization.validateReferentialIntegrity(tenant, recordsWrite, this.messageStore);
      }
    } catch (e) {
      return messageReplyFromError(e, 400);
    }

    // authentication & authorization
    try {
      await authenticate(message.authorization, this.didResolver);
      await RecordsWriteHandler.authorizeRecordsWrite(tenant, recordsWrite, this.messageStore);
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    // get existing messages matching the `recordId`
    const query = {
      interface : DwnInterfaceName.Records,
      recordId  : message.recordId
    };
    const { messages: existingMessages } = await this.messageStore.query(tenant, [ query ]);

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

    try {
      // NOTE: We allow isLatestBaseState to be true ONLY if the incoming message comes with data, or if the incoming message is NOT an initial write
      // This would allow an initial write to be written to the DB without data, but having it not queryable,
      // because query implementation filters on `isLatestBaseState` being `true`
      // thus preventing a user's attempt to gain authorized access to data by referencing the dataCid of a private data in their initial writes,
      // See: https://github.com/TBD54566975/dwn-sdk-js/issues/359 for more info
      let isLatestBaseState = false;
      let messageWithOptionalEncodedData = message as RecordsQueryReplyEntry;

      if (dataStream !== undefined) {
        messageWithOptionalEncodedData = await this.processMessageWithDataStream(tenant, message, dataStream);
        isLatestBaseState = true;
      } else {
        // else data stream is NOT provided

        if (newestExistingMessage?.descriptor.method === DwnMethodName.Delete) {
          throw new DwnError(
            DwnErrorCode.RecordsWriteMissingDataStream,
            'No data stream was provided with the previous message being a delete'
          );
        }

        // at this point we know that newestExistingMessage exists is not a Delete

        // if the incoming message is not an initial write, and no dataStream is provided, we would allow it provided it passes validation
        // processMessageWithoutDataStream() abstracts that logic
        if (!newMessageIsInitialWrite) {
          const newestExistingWrite = newestExistingMessage as RecordsQueryReplyEntry;
          messageWithOptionalEncodedData = await this.processMessageWithoutDataStream(tenant, message, newestExistingWrite );
          isLatestBaseState = true;
        }
      }

      const indexes = await recordsWrite.constructIndexes(isLatestBaseState);
      await this.messageStore.put(tenant, messageWithOptionalEncodedData, indexes);
      await this.eventLog.append(tenant, await Message.getCid(message), indexes);
      this.eventStream.emit(tenant, message, indexes);
    } catch (error) {
      const e = error as any;
      if (e.code === DwnErrorCode.RecordsWriteMissingEncodedDataInPrevious ||
          e.code === DwnErrorCode.RecordsWriteMissingDataInPrevious ||
          e.code === DwnErrorCode.RecordsWriteMissingDataStream ||
          e.code === DwnErrorCode.RecordsWriteMissingDataAssociation ||
          e.code === DwnErrorCode.RecordsWriteDataCidMismatch ||
          e.code === DwnErrorCode.RecordsWriteDataSizeMismatch) {
        return messageReplyFromError(error, 400);
      }

      // else throw
      throw error;
    }

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
   * Returns a `RecordsQueryReplyEntry` with a copy of the incoming message and the incoming data encoded to `Base64URL`.
   */
  public async cloneAndAddEncodedData(message: RecordsWriteMessage, dataBytes: Uint8Array):Promise<RecordsQueryReplyEntry> {
    const recordsWrite: RecordsQueryReplyEntry = { ...message };
    recordsWrite.encodedData = Encoder.bytesToBase64Url(dataBytes);
    return recordsWrite;
  }

  private async processMessageWithDataStream(
    tenant: string,
    message: RecordsWriteMessage,
    dataStream: _Readable.Readable,
  ):Promise<RecordsQueryReplyEntry> {
    let messageWithOptionalEncodedData: RecordsQueryReplyEntry = message;

    // if data is below the threshold, we store it within MessageStore
    if (message.descriptor.dataSize <= DwnConstant.maxDataSizeAllowedToBeEncoded) {
      const dataBytes = await DataStream.toBytes(dataStream!);
      const dataCid = await Cid.computeDagPbCidFromBytes(dataBytes);
      // validate data integrity before setting.
      RecordsWriteHandler.validateDataIntegrity(message.descriptor.dataCid, message.descriptor.dataSize, dataCid, dataBytes.length);
      messageWithOptionalEncodedData = await this.cloneAndAddEncodedData(message, dataBytes);
    } else {
      const messageCid = await Message.getCid(message);
      const result = await this.dataStore.put(tenant, messageCid, message.descriptor.dataCid, dataStream);
      await this.validateDataStoreIntegrity(tenant, message, result.dataCid, result.dataSize);
    }

    return messageWithOptionalEncodedData;
  }

  private async processMessageWithoutDataStream(
    tenant: string,
    message: RecordsWriteMessage,
    newestExistingWrite: RecordsQueryReplyEntry,
  ):Promise<RecordsQueryReplyEntry> {
    const messageWithOptionalEncodedData: RecordsQueryReplyEntry = { ...message }; // clone
    const { dataCid, dataSize } = message.descriptor;

    // Since incoming message is not an initial write, and no dataStream is provided, we first check integrity against newest existing write.
    // we preform the dataCid check in case a user attempts to gain access to data by referencing a different known dataCid,
    // so we insure that the data is already associated with the existing newest message
    // See: https://github.com/TBD54566975/dwn-sdk-js/issues/359 for more info
    RecordsWriteHandler.validateDataIntegrity(dataCid, dataSize, newestExistingWrite.descriptor.dataCid, newestExistingWrite.descriptor.dataSize);

    if (dataSize <= DwnConstant.maxDataSizeAllowedToBeEncoded) {
      // we encode the data from the original write if it is smaller than the data-store threshold
      if (newestExistingWrite.encodedData !== undefined) {
        messageWithOptionalEncodedData.encodedData = newestExistingWrite.encodedData;
      } else {
        throw new DwnError(
          DwnErrorCode.RecordsWriteMissingEncodedDataInPrevious,
          `No dataStream was provided and unable to get data from previous message`
        );
      }
    } else {
      // attempt to retrieve the data from the previous message
      const previousWriteMessageCid = await Message.getCid(newestExistingWrite);
      const dataResults = await this.dataStore.get(tenant, previousWriteMessageCid, message.descriptor.dataCid);

      // if it does not exist we have no previous data to associate.
      if (dataResults === undefined) {
        throw new DwnError(
          DwnErrorCode.RecordsWriteMissingDataInPrevious,
          `No dataStream was provided and unable to get data from previous message`
        );
      }

      const result = await this.dataStore.associate(tenant, await Message.getCid(message), message.descriptor.dataCid);
      if (result === undefined) {
        throw new DwnError(
          DwnErrorCode.RecordsWriteMissingDataAssociation,
          'No dataStream was provided and unable to associate with previous data'
        );
      }
      await this.validateDataStoreIntegrity(tenant, message, result.dataCid, result.dataSize);
    }

    return messageWithOptionalEncodedData;
  }

  /**
   * Validates the data integrity after either putting the data or associating it with a new message.
   * Upon failure deletes the association, and subsequently the data if there are no other associations.
   */
  private async validateDataStoreIntegrity(
    tenant: string,
    message: RecordsWriteMessage,
    dataCid: string,
    dataSize: number
  ): Promise<void> {
    const messageCid = await Message.getCid(message);

    try {
      RecordsWriteHandler.validateDataIntegrity(message.descriptor.dataCid, message.descriptor.dataSize, dataCid, dataSize);
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
  private static validateDataIntegrity(
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

  private static async authorizeRecordsWrite(tenant: string, recordsWrite: RecordsWrite, messageStore: MessageStore): Promise<void> {
    // if owner DID is specified, it must be the same as the tenant DID
    if (recordsWrite.owner !== undefined && recordsWrite.owner !== tenant) {
      throw new DwnError(
        DwnErrorCode.RecordsWriteOwnerAndTenantMismatch,
        `Owner ${recordsWrite.owner} must be the same as tenant ${tenant} when specified.`
      );
    }

    if (recordsWrite.isSignedByDelegate) {
      await recordsWrite.authorizeDelegate(messageStore);
    }

    if (recordsWrite.owner !== undefined) {
      // if incoming message is a write retained by this tenant, we by-design always allow
      // NOTE: the "owner === tenant" check is already done earlier in this method
      return;
    } else if (recordsWrite.author === tenant) {
      // if author is the same as the target tenant, we can directly grant access
      return;
    } else if (recordsWrite.author !== undefined && recordsWrite.signaturePayload!.permissionsGrantId !== undefined) {
      const permissionsGrantMessage = await GrantAuthorization.fetchGrant(tenant, messageStore, recordsWrite.signaturePayload!.permissionsGrantId);
      await RecordsGrantAuthorization.authorizeWrite({
        recordsWriteMessage       : recordsWrite.message,
        expectedGrantedToInGrant  : recordsWrite.author,
        expectedGrantedForInGrant : tenant,
        permissionsGrantMessage,
        messageStore
      });
    } else if (recordsWrite.message.descriptor.protocol !== undefined) {
      await ProtocolAuthorization.authorizeWrite(tenant, recordsWrite, messageStore);
    } else {
      throw new DwnError(DwnErrorCode.RecordsWriteAuthorizationFailed, 'message failed authorization');
    }
  }
}
