import type { DidResolver } from '@web5/dids';
import type { EventLog } from '../types//event-log.js';
import type { EventStream } from '../types/subscriptions.js';
import type { GenericMessageReply } from '../types/message-types.js';
import type { KeyValues } from '../types/query-types.js';
import type { MessageStore } from '../types//message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { PermissionsGrantMessage } from '../types/permissions-types.js';

import { authenticate } from '../core/auth.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { PermissionsGrant } from '../interfaces/permissions-grant.js';
import { removeUndefinedProperties } from '../utils/object.js';

export class PermissionsGrantHandler implements MethodHandler {
  constructor(
    private didResolver: DidResolver,
    private messageStore: MessageStore,
    private eventLog: EventLog,
    private eventStream?: EventStream
  ) { }

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

      // only emit if the event stream is set
      if (this.eventStream !== undefined) {
        this.eventStream.emit(tenant, message, indexes);
      }
    }

    return {
      status: { code: 202, detail: 'Accepted' }
    };
  }

  static constructIndexes(
    permissionsGrant: PermissionsGrant,
  ): KeyValues {
    const message = permissionsGrant.message;
    const { scope, conditions, ...propertiesToIndex } = message.descriptor;
    const indexes: KeyValues = {
      author: permissionsGrant.author!,
      ...propertiesToIndex,
    };

    removeUndefinedProperties(indexes);
    return indexes;
  }
}