import type { InterfaceMethod } from '../../types';
import type { JsonPermissionsRequest } from './types';

import { MessageResult } from '../../../response';
import { PermissionsRequest } from './message';

export const processPermissionsRequest: InterfaceMethod = async (
  ctx,
  message,
  messageStore,
  _didResolver
): Promise<MessageResult> => {
  const request = new PermissionsRequest(message as JsonPermissionsRequest);

  if (ctx.tenant !== request.grantedBy) {
    return new MessageResult({
      status: { code: 400, message: 'grantedBy must be the targeted message recipient' }
    });
  }

  // TODO: verify auth
  // TODO: check if `grantedTo` === message signer

  try {
    await messageStore.put(request);

    return new MessageResult({
      status: { code: 202, message: 'Accepted' }
    });
  } catch(e) {
    return new MessageResult({
      status: { code: 500, message: e.message }
    });
  }
};