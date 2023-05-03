import type { DidResolver } from '../../../index.js';
import type { MethodHandler } from '../../types.js';
import type { RecordsDeleteMessage } from '../types.js';
import type { StorageController } from '../../../store/storage-controller.js';
import type { TimestampedMessage } from '../../../core/types.js';


import { authenticate } from '../../../core/auth.js';
import { deleteAllOlderMessagesButKeepInitialWrite } from '../records-interface.js';
import { MessageReply } from '../../../core/message-reply.js';
import { RecordsDelete } from '../messages/records-delete.js';
import { RecordsWrite } from '../messages/records-write.js';
import { DwnInterfaceName, Message } from '../../../core/message.js';

export class RecordsDeleteHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private storageController: StorageController) { }

  public async handle({
    tenant,
    message
  }: { tenant: string, message: RecordsDeleteMessage}): Promise<MessageReply> {

    let recordsDelete: RecordsDelete;
    try {
      recordsDelete = await RecordsDelete.parse(message);
    } catch (e) {
      return MessageReply.fromError(e, 400);
    }

    // authentication & authorization
    try {
      await authenticate(message.authorization, this.didResolver);
      await recordsDelete.authorize(tenant);
    } catch (e) {
      return MessageReply.fromError(e, 401);
    }

    // get existing records matching the `recordId`
    const query = {
      interface : DwnInterfaceName.Records,
      recordId  : message.descriptor.recordId
    };
    const existingMessages = await this.storageController.queryMessages(tenant, query) as TimestampedMessage[];

    // find which message is the newest, and if the incoming message is the newest
    const newestExistingMessage = await RecordsWrite.getNewestMessage(existingMessages);
    let incomingMessageIsNewest = false;
    let newestMessage;
    // if incoming message is newest
    if (newestExistingMessage === undefined || await RecordsWrite.isNewer(message, newestExistingMessage)) {
      incomingMessageIsNewest = true;
      newestMessage = message;
    } else { // existing message is the same age or newer than the incoming message
      newestMessage = newestExistingMessage;
    }

    // write the incoming message to DB if incoming message is newest
    let messageReply: MessageReply;
    if (incomingMessageIsNewest) {
      const indexes = await constructIndexes(tenant, recordsDelete);

      await this.storageController.putMessage(tenant, message, indexes);

      const messageCid = await Message.getCid(message);
      await this.storageController.appendEvent(tenant, messageCid);

      messageReply = new MessageReply({
        status: { code: 202, detail: 'Accepted' }
      });
    } else {
      messageReply = new MessageReply({
        status: { code: 409, detail: 'Conflict' }
      });
    }

    // delete all existing messages that are not newest, except for the initial write
    await deleteAllOlderMessagesButKeepInitialWrite(tenant, existingMessages, newestMessage, this.storageController);

    return messageReply;
  };
}

export async function constructIndexes(tenant: string, recordsDelete: RecordsDelete): Promise<{ [key: string]: string }> {
  const message = recordsDelete.message;
  const descriptor = { ...message.descriptor };

  // NOTE: the "trick" not may not be apparent on how a query is able to omit deleted records:
  // we intentionally not add index for `isLatestBaseState` at all, this means that upon a successful delete,
  // no messages with the record ID will match any query because queries by design filter by `isLatestBaseState = true`,
  // `isLatestBaseState` for the initial delete would have been toggled to `false`
  const indexes: { [key: string]: any } = {
    // isLatestBaseState : "true", // intentionally showing that this index is omitted
    author: recordsDelete.author,
    ...descriptor
  };

  return indexes;
}
