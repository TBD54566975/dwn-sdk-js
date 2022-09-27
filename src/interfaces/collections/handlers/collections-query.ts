import type { MethodHandler } from '../../types';
import type { CollectionsQueryMessage } from '../types';
import { CollectionsQuery } from '../messages/collections-query';
import { MessageReply } from '../../../core';
import { removeUndefinedProperties } from '../../../utils/object';

export const handleCollectionsQuery: MethodHandler = async (
  message,
  messageStore,
  didResolver
): Promise<MessageReply> => {
  const collectionsQueryMessage = new CollectionsQuery(message as CollectionsQueryMessage);

  try {
    await collectionsQueryMessage.verifyAuth(didResolver, messageStore);
  } catch (e) {
    return new MessageReply({
      status: { code: 401, detail: e.message }
    });
  }

  try {
    const validatedMessage = message as CollectionsQueryMessage;

    if (validatedMessage.descriptor.dateSort) {
      throw new Error('`dateSort` not implemented');
    }

    const query = {
      target : validatedMessage.descriptor.target,
      method : 'CollectionsWrite',
      ...validatedMessage.descriptor.filter
    };
    removeUndefinedProperties(query);

    const entries = await messageStore.query(query);

    return new MessageReply({
      status: { code: 200, detail: 'OK' },
      entries
    });
  } catch (e) {
    return new MessageReply({
      status: { code: 500, detail: e.message }
    });
  }
};
