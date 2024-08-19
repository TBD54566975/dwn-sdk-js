import type { DidResolver } from '@web5/dids';
import type { GenericMessageReply } from '../types/message-types.js';
import type { MessageStore } from '../types//message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { RecordsDeleteMessage } from '../types/records-types.js';
import type { ResumableTaskManager } from '../core/resumable-task-manager.js';

import { authenticate } from '../core/auth.js';
import { DwnInterfaceName } from '../enums/dwn-interface-method.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { ProtocolAuthorization } from '../core/protocol-authorization.js';
import { Records } from '../utils/records.js';
import { RecordsDelete } from '../interfaces/records-delete.js';
import { RecordsWrite } from '../interfaces/records-write.js';
import { ResumableTaskName } from '../core/resumable-task-manager.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

export class RecordsDeleteHandler implements MethodHandler {

  constructor(
    private didResolver: DidResolver,
    private messageStore: MessageStore,
    private resumableTaskManager: ResumableTaskManager,
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

    if (!Records.canPerformDeleteAgainstRecord(message, newestExistingMessage)) {
      return {
        status: { code: 404, detail: 'Not Found' }
      };
    }

    // if the incoming message is not the newest, return Conflict
    const incomingDeleteIsNewest = await Message.isNewer(message, newestExistingMessage!);
    if (!incomingDeleteIsNewest) {
      return {
        status: { code: 409, detail: 'Conflict' }
      };
    }

    // authorization
    try {
      // NOTE: We need a RecordsWrite (doesn't have to be initial) to access the immutable properties for delete processing,
      // but if the latest record state is a RecordsDelete (ie. when we are pruning a non-prune delete),
      // we'd need to use the initial write because RecordsDelete does not contain the immutable properties needed for processing.
      const initialWrite = await RecordsWrite.fetchInitialRecordsWrite(this.messageStore, tenant, message.descriptor.recordId);

      await RecordsDeleteHandler.authorizeRecordsDelete(
        tenant,
        recordsDelete,
        initialWrite!,
        this.messageStore
      );
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    await this.resumableTaskManager.run({
      name : ResumableTaskName.RecordsDelete,
      data : { tenant, message }
    });

    const messageReply = {
      status: { code: 202, detail: 'Accepted' }
    };
    return messageReply;
  };

  /**
   * Authorizes a RecordsDelete message.
   *
   * @param recordsWrite A RecordsWrite of the record to be deleted.
   */
  private static async authorizeRecordsDelete(
    tenant: string,
    recordsDelete: RecordsDelete,
    recordsWrite: RecordsWrite,
    messageStore: MessageStore
  ): Promise<void> {

    if (Message.isSignedByAuthorDelegate(recordsDelete.message)) {
      await recordsDelete.authorizeDelegate(recordsWrite.message, messageStore);
    }

    if (recordsDelete.author === tenant) {
      return;
    } else if (recordsWrite.message.descriptor.protocol !== undefined) {
      await ProtocolAuthorization.authorizeDelete(tenant, recordsDelete, recordsWrite, messageStore);
    } else {
      throw new DwnError(
        DwnErrorCode.RecordsDeleteAuthorizationFailed,
        'RecordsDelete message failed authorization'
      );
    }
  }
};
