import type { MethodHandler } from '../../types.js';
import type { RecordsWriteMessage } from '../types.js';

import { authenticate } from '../../../core/auth.js';
import { deleteAllOlderMessagesButKeepInitialWrite } from '../records-interface.js';
import { DwnErrorCode } from '../../../core/dwn-error.js';
import { DwnInterfaceName } from '../../../core/message.js';
import { MessageReply } from '../../../core/message-reply.js';
import { RecordsWrite } from '../messages/records-write.js';
import type { TimestampedMessage } from '../../../core/types.js';

export const handleRecordsWrite: MethodHandler = async ({
  tenant,
  message,
  messageStore,
  didResolver,
  dataStream
}): Promise<MessageReply> => {
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
    await authenticate(message.authorization, didResolver);
    await recordsWrite.authorize(tenant, messageStore);
  } catch (e) {
    return new MessageReply({
      status: { code: 401, detail: e.message }
    });
  }

  // get existing messages matching the `recordId`
  const query = {
    tenant,
    interface : DwnInterfaceName.Records,
    recordId  : incomingMessage.recordId
  };
  const existingMessages = await messageStore.query(query) as TimestampedMessage[];

  // if the incoming write is not the initial write, then it must not modify any immutable properties defined by the initial write
  const newMessageIsInitialWrite = await recordsWrite.isInitialWrite();
  if (!newMessageIsInitialWrite) {
    try {
      const initialWrite = RecordsWrite.getInitialWrite(existingMessages);
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
    const indexes = await constructRecordsWriteIndexes(tenant, recordsWrite, isLatestBaseState);

    try {
      await messageStore.put(incomingMessage, indexes, dataStream);
    } catch (error) {
      if (error.code === DwnErrorCode.MessageStoreDataCidMismatch ||
          error.code === DwnErrorCode.MessageStoreDataNotFound) {
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
  await deleteAllOlderMessagesButKeepInitialWrite(tenant, existingMessages, newestMessage, messageStore);

  return messageReply;
};

export async function constructRecordsWriteIndexes(
  tenant: string,
  recordsWrite: RecordsWrite,
  isLatestBaseState: boolean
): Promise<{ [key: string]: string }> {
  const message = recordsWrite.message;
  const descriptor = { ...message.descriptor };
  delete descriptor.published; // handle `published` specifically further down

  const indexes: { [key: string]: any } = {
    tenant,
    // NOTE: underlying search-index library does not support boolean, so converting boolean to string before storing
    // https://github.com/TBD54566975/dwn-sdk-js/issues/170
    isLatestBaseState : isLatestBaseState.toString(),
    author            : recordsWrite.author,
    recordId          : message.recordId,
    entryId           : await RecordsWrite.getEntryId(recordsWrite.author, recordsWrite.message.descriptor),
    ...descriptor
  };

  // add additional indexes to optional values if given
  // TODO: index multi-attesters to be unblocked by #205 - Revisit database interfaces (https://github.com/TBD54566975/dwn-sdk-js/issues/205)
  if (recordsWrite.attesters.length > 0) { indexes.attester = recordsWrite.attesters[0]; }
  if (message.contextId !== undefined) { indexes.contextId = message.contextId; }

  // add `published` index
  // NOTE: underlying search-index library does not support boolean, so converting boolean to string before storing
  // https://github.com/TBD54566975/dwn-sdk-js/issues/170
  if (message.descriptor.published === true) {
    indexes.published = 'true';
  } else {
    indexes.published = 'false';
  }

  return indexes;
}
