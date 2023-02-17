import type { MethodHandler } from '../../types.js';
import type { PermissionsRequestMessage } from '../types.js';

import { canonicalAuth } from '../../../core/auth.js';
import { MessageReply } from '../../../core/message-reply.js';
import { PermissionsRequest } from '../messages/permissions-request.js';
import { DataStore, DidResolver, MessageStore } from '../../../index.js';

export class PermissionsRequestHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private messageStore: MessageStore,private dataStore: DataStore) { }

  public async handle({
    tenant,
    message
  }): Promise<MessageReply> {
    const permissionRequest = await PermissionsRequest.parse(message as PermissionsRequestMessage);
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
      tenant,
      author,
      ... message.descriptor
    };
    await this.messageStore.put(message, index);

    return new MessageReply({
      status: { code: 202, detail: 'Accepted' }
    });
  };
}