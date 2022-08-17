import type { CollectionsWriteSchema } from '../types';
import type { MethodHandler } from '../../types';

import { CollectionsWrite } from '../messages/collections-write';
import { generateCid } from '../../../../src/utils/cid';
import { MessageReply } from '../../../core';

export const handleCollectionsWrite: MethodHandler = async (
  context,
  message,
  messageStore,
  didResolver
): Promise<MessageReply> => {
  const collectionsWriteMessage = new CollectionsWrite(message as CollectionsWriteSchema);

  try {
    await collectionsWriteMessage.verifyAuth(didResolver);
  } catch (e) {
    return new MessageReply({
      status: { code: 401, message: e.message }
    });
  }

  try {
    const incomingMessage = message as CollectionsWriteSchema;

    // get existing records matching the `recordId`
    const query = {
      method   : 'CollectionsWrite',
      recordId : incomingMessage.descriptor.recordId
    };
    const existingMessages = await messageStore.query(query, context) as CollectionsWriteSchema[];

    // find which message is the newest, and if the incoming message is the newest
    let newestMessage = await CollectionsWrite.getNewestMessage(existingMessages);
    let incomingMessageIsNewest = false;
    if (newestMessage === undefined || await CollectionsWrite.isNewer(incomingMessage, newestMessage)) {
      incomingMessageIsNewest = true;
      newestMessage = incomingMessage;
    }

    // write the incoming message to DB if incoming message is newest
    let messageReply: MessageReply;
    if (incomingMessageIsNewest) {
      await messageStore.put(message, context);

      messageReply = new MessageReply({
        status: { code: 202, message: 'Accepted' }
      });
    } else {
      messageReply = new MessageReply({
        status: { code: 409, message: 'Conflict' }
      });
    }

    // delete all existing records that are not newest
    for (const message of existingMessages) {
      if (await CollectionsWrite.isNewer(newestMessage, message)) {
        const cid = await generateCid(message);
        await messageStore.delete(cid, context);
      }
    }

    return messageReply;
  } catch (e) {
    return new MessageReply({
      status: { code: 500, message: e.message }
    });
  }
};
