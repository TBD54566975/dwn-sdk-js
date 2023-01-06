import type { CollectionsWriteMessage } from '../types.js';
import type { MethodHandler } from '../../types.js';

import { authenticate } from '../../../core/auth.js';
import { CollectionsWrite } from '../messages/collections-write.js';
import { MessageReply } from '../../../core/message-reply.js';

import { DwnMethodName, Message } from '../../../core/message.js';

export const handleCollectionsWrite: MethodHandler = async (
  message,
  messageStore,
  didResolver
): Promise<MessageReply> => {
  const incomingMessage = message as CollectionsWriteMessage;

  let collectionsWrite: CollectionsWrite;
  try {
    collectionsWrite = await CollectionsWrite.parse(incomingMessage);
  } catch (e) {
    return new MessageReply({
      status: { code: 400, detail: e.message }
    });
  }

  // authentication & authorization
  try {
    await authenticate(message.authorization, didResolver);
    await collectionsWrite.authorize(messageStore);
  } catch (e) {
    return new MessageReply({
      status: { code: 401, detail: e.message }
    });
  }

  // get existing records matching the `recordId`
  const query = {
    target   : collectionsWrite.target,
    method   : DwnMethodName.CollectionsWrite,
    recordId : incomingMessage.recordId
  };
  const existingMessages = await messageStore.query(query) as CollectionsWriteMessage[];

  // if the incoming write is not the lineage root, then it must not modify any immutable properties defined by the lineage root
  if (incomingMessage.descriptor.lineageParent !== undefined) {
    try {
      const lineageRootMessage = CollectionsWrite.getLineageRootMessage(existingMessages);
      CollectionsWrite.verifyEqualityOfImmutableProperties(lineageRootMessage, incomingMessage);
    } catch (e) {
      return new MessageReply({
        status: { code: 400, detail: e.message }
      });
    }
  }

  // find which message is the newest, and if the incoming message is the newest
  const newestExistingMessage = await CollectionsWrite.getNewestMessage(existingMessages);
  let incomingMessageIsNewest = false;
  let newestMessage;
  // if incoming message is newest
  if (newestExistingMessage === undefined || await CollectionsWrite.isNewer(incomingMessage, newestExistingMessage)) {
    // expected lineage parent of the incoming message should not be specified (ie. an originating message) if no existing record exists
    // else the expected lineage parent should just point to originating message (logic will change when CollectionsDelete is implemented)
    const expectedLineageParent = newestExistingMessage?.recordId;
    const incomingMessageLineageParent = incomingMessage.descriptor.lineageParent;
    if (incomingMessageLineageParent !== expectedLineageParent) {
      return new MessageReply({
        status: { code: 400, detail: `expecting lineageParent to be ${expectedLineageParent} but got ${incomingMessageLineageParent}` }
      });
    }

    incomingMessageIsNewest = true;
    newestMessage = incomingMessage;
  } else { // existing message is the same age or newer than the incoming message
    newestMessage = newestExistingMessage;
  }

  // write the incoming message to DB if incoming message is newest
  let messageReply: MessageReply;
  if (incomingMessageIsNewest) {
    const isLatestBaseState = true;
    const indexes = await constructIndexes(collectionsWrite, isLatestBaseState);

    await messageStore.put(incomingMessage, indexes);

    messageReply = new MessageReply({
      status: { code: 202, detail: 'Accepted' }
    });
  } else {
    messageReply = new MessageReply({
      status: { code: 409, detail: 'Conflict' }
    });
  }

  // delete all existing messages that are not newest, except for the originating record
  // NOTE: under normal operation, there should only be at most two existing messages per `recordId`
  // and at most only one message needs to be deleted (prior to CollectionsDelete implementation),
  // but the DWN may crash before `delete()` is called below, so we use a loop as tactic to clean up lingering data as needed
  for (const message of existingMessages) {
    const messageIsOld = await CollectionsWrite.isOlder(message, newestMessage);
    if (messageIsOld) {
      // the easiest implementation here is delete each old messages
      // and re-create it with the right index (isLatestBaseState = 'false') if the message is the originating message,
      // but there is room for better/more efficient implementation here
      const cid = await Message.getCid(message);
      await messageStore.delete(cid);

      // if the message is the originating message
      // we actually need to keep it BUT, need to ensure the message is no longer marked as the latest state
      if (message.descriptor.lineageParent === undefined) {
        const existingCollectionsWrite = await CollectionsWrite.parse(message);
        const isLatestBaseState = false;
        const indexes = await constructIndexes(existingCollectionsWrite, isLatestBaseState);
        await messageStore.put(message, indexes);
      }
    }
  }

  return messageReply;
};

export async function constructIndexes(collectionsWrite: CollectionsWrite, isLatestBaseState: boolean): Promise<{ [key:string]: string }> {
  const message = collectionsWrite.message;
  const descriptor = { ...message.descriptor };
  delete descriptor.published; // handle `published` specifically further down

  const indexes: { [key:string]: any } = {
    // NOTE: underlying search-index library does not support boolean, so converting boolean to string before storing
    // https://github.com/TBD54566975/dwn-sdk-js/issues/170
    isLatestBaseState : isLatestBaseState.toString(),
    author            : collectionsWrite.author,
    target            : collectionsWrite.target,
    recordId          : message.recordId,
    entryId           : await CollectionsWrite.getCanonicalId(collectionsWrite.author, collectionsWrite.message.descriptor),
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
