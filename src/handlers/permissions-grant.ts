import type { DidResolver } from '../did/did-resolver.js';
import type { EventLog } from '../types//event-log.js';
import type { GenericMessageReply } from '../core/message-reply.js';
import type { MessageStore } from '../types//message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { PermissionsGrantMessage } from '../types/permissions-types.js';
import type { RecordsPermissionScope } from '../types/permissions-grant-descriptor.js';

import { authenticate } from '../core/auth.js';
import { DwnInterfaceName } from '../enums/dwn-interface-method.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { PermissionsGrant } from '../interfaces/permissions-grant.js';

export class PermissionsGrantHandler implements MethodHandler {
  constructor(private didResolver: DidResolver, private messageStore: MessageStore, private eventLog: EventLog) { }

  public async handle({
    tenant,
    message
  }: { tenant: string, message: PermissionsGrantMessage }): Promise<GenericMessageReply> {
    let permissionsGrant: PermissionsGrant;
    try {
      permissionsGrant = await PermissionsGrant.parse(message);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }

    try {
      await authenticate(message.authorization, this.didResolver);
      await permissionsGrant.authorize();
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    const indexes = PermissionsGrantHandler.constructIndexes(permissionsGrant);

    // If we have not seen this message before, store it
    const messageCid = await Message.getCid(message);
    const existingMessage = await this.messageStore.get(tenant, messageCid);
    if (existingMessage === undefined) {
      await this.messageStore.put(tenant, message, indexes);
      await this.eventLog.append(tenant, messageCid, indexes);
    }

    return {
      status: { code: 202, detail: 'Accepted' }
    };
  }

  static constructIndexes(
    permissionsGrant: PermissionsGrant,
  ): Record<string, string> {
    const message = permissionsGrant.message;
    const { scope, conditions, ...propertiesToIndex } = message.descriptor;
    let indexes: Record<string, any> = {
      author: permissionsGrant.author!,
      ...propertiesToIndex,
    };

    // additional index information for Records permissions
    if (scope.interface === DwnInterfaceName.Records) {
      const { protocol, protocolPath, schema, contextId } = scope as RecordsPermissionScope;
      indexes = {
        ...indexes,
        contextId,
        protocol,
        protocolPath,
        schema,
      };
    }

    return indexes;
  }
}