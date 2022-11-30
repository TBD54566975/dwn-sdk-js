import type { CollectionsWriteMessage } from '../types';
import type { MethodHandler } from '../../types';

import * as encoder from '../../../utils/encoder';
import { CollectionsWrite } from '../messages/collections-write';
import { DwnMethodName } from '../../../core/message';
import { getDagCid } from '../../../utils/data';
import { Message, MessageReply } from '../../../core';

export const handleCollectionsWrite: MethodHandler = async (
  message,
  messageStore,
  didResolver
): Promise<MessageReply> => {
  try {
    // verify dataCid matches given data
    const incomingMessage = message as CollectionsWriteMessage;
    if (incomingMessage.encodedData !== undefined) {
      const rawData = encoder.base64urlToBytes(incomingMessage.encodedData);
      const actualDataCid = (await getDagCid(rawData)).toString();

      if (actualDataCid !== incomingMessage.descriptor.dataCid) {
        return new MessageReply({
          status: { code: 400, detail: 'actual CID of data and `dataCid` in descriptor mismatch' }
        });
      }
    }

    // authentication & authorization
    try {
      const collectionsWrite = new CollectionsWrite(incomingMessage);
      await collectionsWrite.verifyAuth(didResolver, messageStore);
    } catch (e) {
      return new MessageReply({
        status: { code: 401, detail: e.message }
      });
    }

    // get existing records matching the `recordId`
    const query = {
      target   : incomingMessage.descriptor.target,
      method   : DwnMethodName.CollectionsWrite,
      recordId : incomingMessage.recordId
    };
    const existingMessages = await messageStore.query(query) as CollectionsWriteMessage[];

    // find which message is the newest, and if the incoming message is the newest
    let newestMessage = await CollectionsWrite.getNewestMessage(existingMessages);
    let incomingMessageIsNewest = false;
    if (newestMessage === undefined || await CollectionsWrite.isNewer(incomingMessage, newestMessage)) {
      const expectedLineageParent = newestMessage ? newestMessage.recordId : undefined; // logic will change when CollectionsDelete is implemented
      const incomingMessageLineageParent = incomingMessage.descriptor.lineageParent;
      if (incomingMessageLineageParent !== expectedLineageParent) {
        return new MessageReply({
          status: { code: 400, detail: `expecting lineageParent to be ${expectedLineageParent} but got ${incomingMessageLineageParent}` }
        });
      }

      incomingMessageIsNewest = true;
      newestMessage = incomingMessage;
    }

    // write the incoming message to DB if incoming message is newest
    let messageReply: MessageReply;
    if (incomingMessageIsNewest) {
      const isLatestBaseState = true;
      const additionalIndexes = constructAdditionalIndexes(incomingMessage, isLatestBaseState);

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
    // NOTE: in theory, there can only be at most two existing messages per record ID (prior to CollectionsDelete implementation)
    for (const message of existingMessages) {
      const messageIsOld = await CollectionsWrite.isOlder(message, newestMessage);
      if (messageIsOld) {
        // the easiest implementation here is delete all old messages
        // and re-create it with the right index (isLatestBaseState == false) if the message is the originating message,
        // but there is room for better/more efficient implementation here
        const cid = await Message.getCid(message);
        await messageStore.delete(cid);

        // if the message is the originating message
        // we need to keep it BUT, need to ensure message is no longer marked as the latest state
        if (message.descriptor.lineageParent === undefined) {
          const isLatestBaseState = false;
          const additionalIndexes = constructAdditionalIndexes(message, isLatestBaseState);
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

export function constructAdditionalIndexes(message: CollectionsWriteMessage, isLatestBaseState: boolean): { [key:string]: string } {
  const additionalIndexes: { [key:string]: string } = {
    isLatestBaseState : isLatestBaseState.toString(), // NOTE: underlying search-index library does not support boolean, so convert to string
    recordId          : message.recordId,
    author            : Message.getAuthor(message)
  };

  // add `contextId` to additional index if part if given
  if (message.contextId !== undefined) { additionalIndexes.contextId = message.contextId; }

  return additionalIndexes;
}
