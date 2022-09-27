import type { MethodHandler } from '../../types';
import type { PermissionsRequestMessage } from '../types';

import { MessageReply } from '../../../core';
import { PermissionsRequest } from '../messages/permissions-request';

export const handlePermissionsRequest: MethodHandler = async (
  message,
  messageStore,
  didResolver
): Promise<MessageReply> => {
  const request = new PermissionsRequest(message as PermissionsRequestMessage);

  if (message.descriptor.target !== request.grantedBy && message.descriptor.target !== request.grantedTo) {
    return new MessageReply({
      status: { code: 400, detail: 'grantedBy or grantedTo must be the targeted message recipient' }
    });
  }

  // TODO: should we add an explicit check to ensure that there's only 1 signer?, Issue #65 https://github.com/TBD54566975/dwn-sdk-js/issues/65
  const { signers } = await request.verifyAuth(didResolver, messageStore);
  const [ signer ] = signers;

  if (signer !== request.grantedTo) {
    throw new Error('grantee must be signer');
  }

  try {
    await messageStore.put(message);

    return new MessageReply({
      status: { code: 202, detail: 'Accepted' }
    });
  } catch (e) {
    return new MessageReply({
      status: { code: 500, detail: e.message }
    });
  }
};