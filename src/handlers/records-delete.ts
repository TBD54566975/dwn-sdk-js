import type { DataStore } from '../types/data-store.js';
import type { DidResolver } from '@web5/dids';
import type { EventLog } from '../types/event-log.js';
import type { EventStream } from '../types/subscriptions.js';
import type { GenericMessageReply } from '../types/message-types.js';
import type { MessageStore } from '../types//message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { RecordsDeleteMessage, RecordsWriteMessage } from '../types/records-types.js';

import { authenticate } from '../core/auth.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { ProtocolAuthorization } from '../core/protocol-authorization.js';
import { RecordsDelete } from '../interfaces/records-delete.js';
import { RecordsWrite } from '../interfaces/records-write.js';
import { StorageController } from '../store/storage-controller.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export class RecordsDeleteHandler implements MethodHandler {

  constructor(
    private didResolver: DidResolver,
    private messageStore: MessageStore,
    private dataStore: DataStore,
    private eventLog: EventLog,
    private eventStream?: EventStream
  ) { }

  public async handle({
    tenant,
    message
  }: { tenant: string, message: RecordsDeleteMessage}): Promise<GenericMessageReply> {
    let recordsDelete: RecordsDelete;
    try {
      recordsDelete = await RecordsDelete.parse(message);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }

    // authentication
    try {
      await authenticate(message.authorization, this.didResolver);
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    // get existing records matching the `recordId`
    const query = {
      interface : DwnInterfaceName.Records,
      recordId  : message.descriptor.recordId
    };
    const { messages: existingMessages } = await this.messageStore.query(tenant, [ query ]);

    // find which message is the newest, and if the incoming message is the newest
    const newestExistingMessage = await Message.getNewestMessage(existingMessages);
    let incomingMessageIsNewest = false;
    let newestMessage;
    // if incoming message is newest
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

    // return Not Found if record does not exist or is already deleted
    if (newestExistingMessage === undefined || newestExistingMessage.descriptor.method === DwnMethodName.Delete) {
      return {
        status: { code: 404, detail: 'Not Found' }
      };
    }

    // authorization
    try {
      await RecordsDeleteHandler.authorizeRecordsDelete(
        tenant,
        recordsDelete,
        await RecordsWrite.parse(newestExistingMessage as RecordsWriteMessage),
        this.messageStore
      );
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    const initialWrite = await RecordsWrite.getInitialWrite(existingMessages);
    const indexes = recordsDelete.constructIndexes(initialWrite);
    const messageCid = await Message.getCid(message);
    await this.messageStore.put(tenant, message, indexes);
    await this.eventLog.append(tenant, messageCid, indexes);

    // only emit if the event stream is set
    if (this.eventStream !== undefined) {
      this.eventStream.emit(tenant, { message, initialWrite }, indexes);
    }

    if (message.descriptor.prune) {
      // purge/hard-delete all descendent records
      await StorageController.purgeRecordDescendants(tenant, message.descriptor.recordId, this.messageStore, this.dataStore, this.eventLog);
    }

    // delete all existing messages that are not newest, except for the initial write
    await StorageController.deleteAllOlderMessagesButKeepInitialWrite(
      tenant, existingMessages, newestMessage, this.messageStore, this.dataStore, this.eventLog
    );

    const messageReply = {
      status: { code: 202, detail: 'Accepted' }
    };
    return messageReply;
  };

  /**
   * Authorizes a RecordsDelete message.
   *
   * @param newestRecordsWrite Newest RecordsWrite of the record to be deleted.
   */
  private static async authorizeRecordsDelete(
    tenant: string,
    recordsDelete: RecordsDelete,
    newestRecordsWrite: RecordsWrite,
    messageStore: MessageStore
  ): Promise<void> {

    if (Message.isSignedByAuthorDelegate(recordsDelete.message)) {
      await recordsDelete.authorizeDelegate(newestRecordsWrite.message, messageStore);
    }

    if (recordsDelete.author === tenant) {
      return;
    } else if (newestRecordsWrite.message.descriptor.protocol !== undefined) {
      await ProtocolAuthorization.authorizeDelete(tenant, recordsDelete, newestRecordsWrite, messageStore);
    } else {
      throw new DwnError(
        DwnErrorCode.RecordsDeleteAuthorizationFailed,
        'RecordsDelete message failed authorization'
      );
    }
  }
};
