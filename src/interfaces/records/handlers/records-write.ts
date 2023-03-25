import type { MethodHandler } from '../../types.js';
import type { RecordsWriteMessage } from '../types.js';
import type { TimestampedMessage } from '../../../core/types.js';
import type { DataStore, DidResolver, MessageStore, UploadStore } from '../../../index.js';

import { authenticate } from '../../../core/auth.js';
import { deleteAllOlderMessagesButKeepInitialWrite } from '../records-interface.js';
import { DwnErrorCode } from '../../../core/dwn-error.js';
import { DwnInterfaceName } from '../../../core/message.js';
import { MessageReply } from '../../../core/message-reply.js';
import { RecordsWrite } from '../messages/records-write.js';
import { StorageController } from '../../../store/storage-controller.js';

export class RecordsWriteHandler implements MethodHandler {

  constructor(
    private didResolver: DidResolver,
    private messageStore: MessageStore,
    private dataStore: DataStore,
    private uploadStore: UploadStore
  ) { }

  public async handle({
    tenant,
    message,
    dataStream
  }): Promise<MessageReply> {
    const incomingMessage = message as RecordsWriteMessage;

    let recordsWrite: RecordsWrite;
    try {
      recordsWrite = await RecordsWrite.parse(incomingMessage);
    } catch (e) {
      return new MessageReply({
        status: { code: 400, detail: e.message }
      });
    }

    // authentication & authorization
    try {
      await authenticate(message.authorization, this.didResolver);
      await recordsWrite.authorize(tenant, this.messageStore);
    } catch (e) {
      return new MessageReply({
        status: { code: 401, detail: e.message }
      });
    }

    const isUpload = await this.uploadStore.has(tenant, incomingMessage.recordId);
    if (isUpload) {
      return new MessageReply({
        status: { code: 400, detail: 'upload already exists' }
      });
    }

    // get existing messages matching the `recordId`
    const query = {
      interface : DwnInterfaceName.Records,
      recordId  : incomingMessage.recordId
    };
    const existingMessages = await this.messageStore.query(tenant, query) as TimestampedMessage[];

    // if the incoming write is not the initial write, then it must not modify any immutable properties defined by the initial write
    const newMessageIsInitialWrite = await recordsWrite.isInitialWrite();
    if (!newMessageIsInitialWrite) {
      try {
        const initialWrite = await RecordsWrite.getInitialWrite(existingMessages);
        RecordsWrite.verifyEqualityOfImmutableProperties(initialWrite, incomingMessage);
      } catch (e) {
        return new MessageReply({
          status: { code: 400, detail: e.message }
        });
      }
    }

    // find which message is the newest, and if the incoming message is the newest
    const newestExistingMessage = await RecordsWrite.getNewestMessage(existingMessages);

    let incomingMessageIsNewest = false;
    let newestMessage;
    // if incoming message is newest
    if (newestExistingMessage === undefined || await RecordsWrite.isNewer(incomingMessage, newestExistingMessage)) {
      incomingMessageIsNewest = true;
      newestMessage = incomingMessage;
    } else { // existing message is the same age or newer than the incoming message
      newestMessage = newestExistingMessage;
    }

    // write the incoming message to DB if incoming message is newest
    let messageReply: MessageReply;
    if (incomingMessageIsNewest) {
      const isLatestBaseState = true;
      const indexes = await constructRecordsWriteIndexes(recordsWrite, isLatestBaseState);

      try {
        await StorageController.put(this.messageStore, this.dataStore, tenant, incomingMessage, indexes, dataStream);
      } catch (error) {
        if (error.code === DwnErrorCode.MessageStoreDataCidMismatch ||
            error.code === DwnErrorCode.MessageStoreDataNotFound ||
            error.code === DwnErrorCode.MessageStoreDataSizeMismatch) {
          return new MessageReply({
            status: { code: 400, detail: error.message }
          });
        }

        // else throw
        throw error;
      }

      messageReply = new MessageReply({
        status: { code: 202, detail: 'Accepted' }
      });
    } else {
      messageReply = new MessageReply({
        status: { code: 409, detail: 'Conflict' }
      });
    }

    // delete all existing messages that are not newest, except for the initial write
    await deleteAllOlderMessagesButKeepInitialWrite(tenant, existingMessages, newestMessage, this.messageStore, this.dataStore);

    return messageReply;
  };
}

export async function constructRecordsWriteIndexes(
  recordsWrite: RecordsWrite,
  isLatestBaseState: boolean
): Promise<{ [key: string]: string }> {
  const message = recordsWrite.message;
  const descriptor = { ...message.descriptor };
  delete descriptor.published; // handle `published` specifically further down

  const indexes: { [key: string]: any } = {
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
