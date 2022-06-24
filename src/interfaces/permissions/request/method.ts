import type { InterfaceMethod } from '../../types';
import type { JsonPermissionsRequest } from './types';

import { MessageResult } from '../../../response';
import { PermissionsRequest } from './message';

export const processPermissionsRequest: InterfaceMethod = async (
  ctx,
  message,
  messageStore,
  didResolver
): Promise<MessageResult> => {
  const request = new PermissionsRequest(message as JsonPermissionsRequest);

  if (ctx.tenant !== request.grantedBy && ctx.tenant !== request.grantedTo) {
    return new MessageResult({
      status: { code: 400, message: 'grantedBy or grantedTo must be the targeted message recipient' }
    });
  }

  // TODO: should we add an explicit check to ensure that there's only 1 signer?
  const { signers } = await request.verifyAuth(didResolver);
  const [ signer ] = signers;

  if (signer !== request.grantedTo) {
    throw new Error('grantee must be signer');
  }

  try {
    await messageStore.put(request, ctx);

    return new MessageResult({
      status: { code: 202, message: 'Accepted' }
    });
  } catch(e) {
    return new MessageResult({
      status: { code: 500, message: e.message }
    });
  }
};