import type { EventLog } from '../../../event-log/event-log.js';
import type { MethodHandler } from '../../types.js';
import type { Readable } from 'readable-stream';
import type { RecordsWriteMessage } from '../types.js';
import type { BaseMessage, TimestampedMessage } from '../../../core/types.js';
import type { DataStore, DidResolver, MessageStore } from '../../../index.js';

import { authenticate } from '../../../core/auth.js';
import { deleteAllOlderMessagesButKeepInitialWrite } from '../records-interface.js';
import { DwnError, DwnErrorCode } from '../../../core/dwn-error.js';
import { DwnInterfaceName, Message } from '../../../core/message.js';
import { MessageReply } from '../../../core/message-reply.js';
import { RecordsWrite } from '../messages/records-write.js';
import { StorageController } from '../../../store/storage-controller.js';

export class RecordsWriteHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private messageStore: MessageStore,private dataStore: DataStore, private eventLog: EventLog) { }

  public async handle({
    tenant,
    message,
    dataStream
  }: { tenant: string, message: RecordsWriteMessage, dataStream?: _Readable.Readable}): Promise<MessageReply> {

    let recordsWrite: RecordsWrite;
    try {
      recordsWrite = await RecordsWrite.parse(message);
    } catch (e) {
      return MessageReply.fromError(e, 400);
    }

    // authentication & authorization
    try {
      await authenticate(message.authorization, this.didResolver);
      await recordsWrite.authorize(tenant, this.messageStore);
    } catch (e) {
      return MessageReply.fromError(e, 401);
    }

    // get existing messages matching the `recordId`
    const query = {
      interface : DwnInterfaceName.Records,
      recordId  : message.recordId
    };
    const existingMessages = await this.messageStore.query(tenant, query) as TimestampedMessage[];

    // if the incoming write is not the initial write, then it must not modify any immutable properties defined by the initial write
    const newMessageIsInitialWrite = await recordsWrite.isInitialWrite();
    if (!newMessageIsInitialWrite) {
      try {
        const initialWrite = await RecordsWrite.getInitialWrite(existingMessages);
        RecordsWrite.verifyEqualityOfImmutableProperties(initialWrite, message);
      } catch (e) {
        return MessageReply.fromError(e, 400);
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
      return new MessageReply({
        status: { code: 409, detail: 'Conflict' }
      });
    }

    const isLatestBaseState = true;
    const indexes = await constructRecordsWriteIndexes(recordsWrite, isLatestBaseState);

    try {
      this.validateUndefinedDataStream(dataStream, newestExistingMessage, message);

      await this.storeMessage(this.messageStore, this.dataStore, this.eventLog, tenant, message, indexes, dataStream);
    } catch (error) {
      const e = error as any;
      if (e.code === DwnErrorCode.StorageControllerDataCidMismatch ||
          e.code === DwnErrorCode.StorageControllerDataSizeMismatch ||
          e.code === DwnErrorCode.RecordsWriteMissingDataStream) {
        return MessageReply.fromError(error, 400);
      }

      // else throw
      throw error;
    }

    const messageReply = new MessageReply({
      status: { code: 202, detail: 'Accepted' }
    });

    // delete all existing messages that are not newest, except for the initial write
    await deleteAllOlderMessagesButKeepInitialWrite(tenant, existingMessages, newestMessage, this.messageStore, this.dataStore, this.eventLog);

    return messageReply;
  };

  /**
   * Further validation if data stream is undefined.
   * NOTE: if data stream is not be provided but `dataCid` is provided,
   * then we need to make sure that the existing record state is referencing the same data as the incoming message.
   * Without this check will lead to unauthorized access of data (https://github.com/TBD54566975/dwn-sdk-js/issues/359)
   */
  protected validateUndefinedDataStream(
    dataStream: _Readable.Readable | undefined,
    newestExistingMessage: TimestampedMessage | undefined,
    incomingMessage: RecordsWriteMessage): void {
    if (dataStream === undefined && incomingMessage.descriptor.dataCid !== undefined) {
      if (newestExistingMessage?.descriptor.dataCid !== incomingMessage.descriptor.dataCid) {
        throw new DwnError(
          DwnErrorCode.RecordsWriteMissingDataStream,
          'Data stream is not provided.'
        );
      }
    }
  }

  /**
   * Stores the given message and its data in the underlying database(s).
   * NOTE: this method was created to allow a child class to override the default behavior for sync feature to work:
   * ie. allow `RecordsWrite` to be written even if data stream is not provided to handle the case that:
   * a `RecordsDelete` has happened, as a result a DWN would have pruned the data associated with the original write.
   * This approach avoids the need to duplicate the entire handler.
   */
  protected async storeMessage(
    messageStore: MessageStore,
    dataStore: DataStore,
    eventLog: EventLog,
    tenant: string,
    message: BaseMessage,
    indexes: Record<string, string>,
    dataStream?: Readable): Promise<void> {
    await StorageController.put(messageStore, dataStore, eventLog, tenant, message, indexes, dataStream);
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
