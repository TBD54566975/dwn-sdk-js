import type { CollectionsWriteSchema } from '../types';
import type { MethodHandler } from '../../types';

import { CollectionsWrite } from '../messages/collections-write';
import { generateCid } from '../../../../src/utils/cid';
import { MessageReply } from '../../../core';
import { removeUndefinedProperties } from '../../../utils/object';

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
    const validatedMessage = message as CollectionsWriteSchema;

    // get existing records matching the `recordId`
    const query = {
      method   : 'CollectionsWrite',
      recordId : validatedMessage.descriptor.recordId
    };
    removeUndefinedProperties(query);
    const messages = await messageStore.query(query, context);

    // delete all records that are older
    let anExistingNewerOrSameMessage;
    for (const message of messages) {
      const ageCompareResult = await CollectionsWrite.compareCreationTime(message as CollectionsWriteSchema, validatedMessage);
      if (ageCompareResult < 0) {
        const cid = await generateCid(message);
        await messageStore.delete(cid, context);
      } else {
        anExistingNewerOrSameMessage = message; // okay to be assigned more than once
      }
    }

    // write the incoming message to DB if no existing message are newer
    let messageReply: MessageReply;
    if (anExistingNewerOrSameMessage === undefined) {
      await messageStore.put(message, context);

      messageReply = new MessageReply({
        status: { code: 202, message: 'Accepted' }
      });
    } else {
      messageReply = new MessageReply({
        status: { code: 409, message: 'Conflict' }
      });
    }

    return messageReply;
  } catch (e) {
    return new MessageReply({
      status: { code: 500, message: e.message }
    });
  }
};
