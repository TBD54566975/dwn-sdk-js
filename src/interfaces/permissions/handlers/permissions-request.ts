import type { MethodHandler } from '../../types.js';
import type { PermissionsRequestMessage } from '../types.js';
import type { DataStore, DidResolver, MessageStore } from '../../../index.js';

import { canonicalAuth } from '../../../core/auth.js';
import { MessageReply } from '../../../core/message-reply.js';
import { PermissionsRequest } from '../messages/permissions-request.js';

export class PermissionsRequestHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private messageStore: MessageStore,private dataStore: DataStore) { }

  public async handle({
    tenant,
    message
  }: {tenant: string, message: PermissionsRequestMessage}): Promise<MessageReply> {
    const permissionRequest = await PermissionsRequest.parse(message);
    const { author } = permissionRequest;

    if (tenant !== permissionRequest.grantedBy && tenant !== permissionRequest.grantedTo) {
      return new MessageReply({
        status: { code: 400, detail: 'grantedBy or grantedTo must be the targeted message recipient' }
      });
    }

    await canonicalAuth(tenant, permissionRequest, this.didResolver);

    if (author !== permissionRequest.grantedTo) {
      throw new Error('grantee must be signer');
    }

    const index = {
      author,
      ... message.descriptor
    };
    await this.messageStore.put(tenant, message, index as any); // FIXME

    return new MessageReply({
      status: { code: 202, detail: 'Accepted' }
    });
  };
}