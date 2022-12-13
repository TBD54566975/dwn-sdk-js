import type { CollectionsWriteMessage } from '../types.js';
import type { MethodHandler } from '../../types.js';

import { CollectionsWrite } from '../messages/collections-write.js';
import { DwnMethodName } from '../../../core/message.js';
import { Message, MessageReply } from '../../../core/index.js';

export const handleCollectionsWrite: MethodHandler = async (
  message,
  messageStore,
  didResolver
): Promise<MessageReply> => {
  try {
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
      await collectionsWrite.verifyAuth(didResolver, messageStore);
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
    const newestExistingMessage = await CollectionsWrite.getNewestMessage(existingMessages);

    // find which message is the newest, and if the incoming message is the newest
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
      const additionalIndexes = constructAdditionalIndexes(collectionsWrite, isLatestBaseState);

      await messageStore.put(incomingMessage, additionalIndexes);

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
          const additionalIndexes = constructAdditionalIndexes(existingCollectionsWrite, isLatestBaseState);
          await messageStore.put(message, additionalIndexes);
        }
      }
    }

    return messageReply;
  } catch (e) {
    return new MessageReply({
      status: { code: 500, detail: e.message }
    });
  }
};

export function constructAdditionalIndexes(collectionsWrite: CollectionsWrite, isLatestBaseState: boolean): { [key:string]: string } {
  const message = collectionsWrite.message;
  const additionalIndexes: { [key:string]: string } = {
    isLatestBaseState : isLatestBaseState.toString(), // NOTE: underlying search-index library does not support boolean, so convert to string
    author            : collectionsWrite.author,
    target            : collectionsWrite.target,
    recordId          : message.recordId,
  };

  // add `contextId` to additional index if part if given
  if (message.contextId !== undefined) { additionalIndexes.contextId = message.contextId; }

  return additionalIndexes;
}
