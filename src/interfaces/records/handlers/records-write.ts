import type { MethodHandler } from '../../types.js';
import type { RecordsWriteMessage } from '../types.js';

import { authenticate } from '../../../core/auth.js';
import { MessageReply } from '../../../core/message-reply.js';
import { RecordsWrite } from '../messages/records-write.js';

import { DwnMethodName, Message } from '../../../core/message.js';

export const handleRecordsWrite: MethodHandler = async (
  message,
  messageStore,
  didResolver
): Promise<MessageReply> => {
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
    await recordsWrite.authorize(messageStore);
  } catch (e) {
    return new MessageReply({
      status: { code: 401, detail: e.message }
    });
  }

  // get existing records matching the `recordId`
  const query = {
    target   : recordsWrite.target,
    method   : DwnMethodName.RecordsWrite,
    recordId : incomingMessage.recordId
  };
  const existingMessages = await messageStore.query(query) as RecordsWriteMessage[];

  // if the incoming write is not the initial write, then it must not modify any immutable properties defined by the initial write
  const newMessageIsInitialWrite = await recordsWrite.isInitialWrite();
  if (!newMessageIsInitialWrite) {
    try {
      if (existingMessages.length === 0) {
        throw new Error(`initial write is not found `);
      }

      const anExistingWrite = existingMessages[0]; // the assertion here is that any existing write should contain all immutable properties
      RecordsWrite.verifyEqualityOfImmutableProperties(anExistingWrite, incomingMessage);
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
    const indexes = await constructIndexes(recordsWrite, isLatestBaseState);

    await messageStore.put(incomingMessage, indexes);

    messageReply = new MessageReply({
      status: { code: 202, detail: 'Accepted' }
    });
  } else {
    messageReply = new MessageReply({
      status: { code: 409, detail: 'Conflict' }
    });
  }

  // delete all existing messages that are not newest, except for the initial write
  // NOTE: under normal operation, there should only be one existing write per `recordId` (the initial write),
  // but the DWN may crash before `delete()` is called below, so we use a loop as a tactic to clean up lingering data as needed
  for (const message of existingMessages) {
    const messageIsOld = await RecordsWrite.isOlder(message, newestMessage);
    if (messageIsOld) {
      // the easiest implementation here is delete each old messages
      // and re-create it with the right index (isLatestBaseState = 'false') if the message is the initial write,
      // but there is room for better/more efficient implementation here
      const cid = await Message.getCid(message);
      await messageStore.delete(cid);

      // if the existing message is the initial write
      // we actually need to keep it BUT, need to ensure the message is no longer marked as the latest state
      const existingMessageIsInitialWrite = await RecordsWrite.isInitialWrite(message);
      if (existingMessageIsInitialWrite) {
        const existingRecordsWrite = await RecordsWrite.parse(message);
        const isLatestBaseState = false;
        const indexes = await constructIndexes(existingRecordsWrite, isLatestBaseState);
        await messageStore.put(message, indexes);
      }
    }
  }

  return messageReply;
};

export async function constructIndexes(recordsWrite: RecordsWrite, isLatestBaseState: boolean): Promise<{ [key: string]: string }> {
  const message = recordsWrite.message;
  const descriptor = { ...message.descriptor };
  delete descriptor.published; // handle `published` specifically further down

  const indexes: { [key: string]: any } = {
    // NOTE: underlying search-index library does not support boolean, so converting boolean to string before storing
    // https://github.com/TBD54566975/dwn-sdk-js/issues/170
    isLatestBaseState : isLatestBaseState.toString(),
    author            : recordsWrite.author,
    target            : recordsWrite.target,
    recordId          : message.recordId,
    entryId           : await RecordsWrite.getEntryId(recordsWrite.author, recordsWrite.message.descriptor),
    ...descriptor
  };

  // add `contextId` to additional index if part if given
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
