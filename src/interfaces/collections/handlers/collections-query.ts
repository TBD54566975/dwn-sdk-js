import type { MethodHandler } from '../../types';
import type { CollectionsQuerySchema } from '../types';
import { CollectionsQuery } from '../messages/collections-query';
import { MessageReply } from '../../../core';

export const handleCollectionsQuery: MethodHandler = async (
  context,
  message,
  messageStore,
  didResolver
): Promise<MessageReply> => {
  const collectionsQueryMessage = new CollectionsQuery(message as CollectionsQuerySchema);

  try {
    await collectionsQueryMessage.verifyAuth(didResolver);
  } catch (e) {
    return new MessageReply({
      status: { code: 401, message: e.message }
    });
  }

  try {
    // TODO
    const query = { };
    await messageStore.query(query, context);

    return new MessageReply({
      status  : { code: 200, message: 'OK' },
      entries : []
    });
  } catch (e) {
    return new MessageReply({
      status: { code: 500, message: e.message }
    });
  }
};
