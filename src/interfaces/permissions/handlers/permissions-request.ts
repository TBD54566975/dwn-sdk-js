import type { MethodHandler } from '../../types.js';
import type { PermissionsRequestMessage } from '../types.js';

import { MessageReply } from '../../../core/index.js';
import { PermissionsRequest } from '../messages/permissions-request.js';

export const handlePermissionsRequest: MethodHandler = async (
  message,
  messageStore,
  didResolver
): Promise<MessageReply> => {
  const request = await PermissionsRequest.parse(message as PermissionsRequestMessage);
  const { author, target } = request;

  if (request.target !== request.grantedBy && request.target !== request.grantedTo) {
    return new MessageReply({
      status: { code: 400, detail: 'grantedBy or grantedTo must be the targeted message recipient' }
    });
  }

  await request.verifyAuth(didResolver, messageStore);

  if (author !== request.grantedTo) {
    throw new Error('grantee must be signer');
  }

  try {
    await messageStore.put(message, { author, target });

    return new MessageReply({
      status: { code: 202, detail: 'Accepted' }
    });
  } catch (e) {
    return new MessageReply({
      status: { code: 500, detail: e.message }
    });
  }
};