import type { MethodHandler } from '../../types';
import type { PermissionsRequestMessage } from '../types';

import { MessageReply } from '../../../core';
import { PermissionsRequest } from '../messages/permissions-request';

export const handlePermissionsRequest: MethodHandler = async (
  message,
  messageStore,
  didResolver
): Promise<MessageReply> => {
  const request = await PermissionsRequest.parse(message as PermissionsRequestMessage);

  if (request.target !== request.grantedBy && request.target !== request.grantedTo) {
    return new MessageReply({
      status: { code: 400, detail: 'grantedBy or grantedTo must be the targeted message recipient' }
    });
  }

  const { author } = await request.verifyAuth(didResolver, messageStore);

  if (author !== request.grantedTo) {
    throw new Error('grantee must be signer');
  }

  try {
    await messageStore.put(message, { author });

    return new MessageReply({
      status: { code: 202, detail: 'Accepted' }
    });
  } catch (e) {
    return new MessageReply({
      status: { code: 500, detail: e.message }
    });
  }
};