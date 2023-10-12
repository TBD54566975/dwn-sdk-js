import type { GenericMessageReply } from '../core/message-reply.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { DidResolver, EventLog, MessageStore } from '../index.js';
import type { PermissionsGrantMessage, RecordsPermissionScope } from '../types/permissions-types.js';

import { authenticate } from '../core/auth.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { PermissionsGrant } from '../interfaces/permissions-grant.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { DwnInterfaceName, Message } from '../core/message.js';

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
      const additionalIndexes = PermissionsGrantHandler.constructAdditionalIndexes(permissionsGrant);
      await this.eventLog.append(tenant, messageCid, { ...indexes, ...additionalIndexes });
    }

    return {
      status: { code: 202, detail: 'Accepted' }
    };
  }

  /**
  * Indexed properties needed for MessageStore indexing.
  */
  static constructIndexes(
    permissionsGrant: PermissionsGrant,
  ): Record<string, string> {
    const message = permissionsGrant.message;
    const { scope, conditions, ...propertiesToIndex } = message.descriptor;

    const indexes: Record<string, any> = {
      author: permissionsGrant.author!,
      ...propertiesToIndex,
    };
    return indexes;
  }

  /**
   * Additional indexes that are not needed within the MessageStore but are necessary within the EventLog.
   */
  static constructAdditionalIndexes(
    permissionsGrant: PermissionsGrant
  ): Record<string, string> {
    let indexes: Record<string,any> = {};
    const { scope } = permissionsGrant.message.descriptor;
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
    removeUndefinedProperties(indexes);
    return indexes;
  }
}