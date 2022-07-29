import type { MethodHandler } from '../../types';
import type { CollectionsWriteSchema } from '../types';
import { CollectionsWrite } from '../messages/collections-write';
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
    await messageStore.put(collectionsWriteMessage, context);

    return new MessageReply({
      status: { code: 202, message: 'Accepted' }
    });
  } catch (e) {
    return new MessageReply({
      status: { code: 500, message: e.message }
    });
  }
};
