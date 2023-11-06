import type { DidResolver } from '../did/did-resolver.js';
import type { EventLog } from '../types//event-log.js';
import type { GenericMessageReply } from '../core/message-reply.js';
import type { MessageStore } from '../types//message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { PermissionsRequestMessage } from '../types/permissions-types.js';

import { authenticate } from '../core/auth.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { PermissionsRequest } from '../interfaces/permissions-request.js';

export class PermissionsRequestHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private messageStore: MessageStore, private eventLog: EventLog) { }

  public async handle({
    tenant,
    message
  }: { tenant: string, message: PermissionsRequestMessage }): Promise<GenericMessageReply> {
    let permissionsRequest: PermissionsRequest;
    try {
      permissionsRequest = await PermissionsRequest.parse(message);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }

    // authentication
    try {
      await authenticate(message.authorization, this.didResolver);
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    // store message
    const { scope, conditions, ...propertiesToIndex } = message.descriptor;
    const indexes: { [key: string]: string } = {
      ...propertiesToIndex,
      author: permissionsRequest.author!,
    };

    // If we have not seen this message before, store it
    const messageCid = await Message.getCid(message);
    const existingMessage = await this.messageStore.get(tenant, messageCid);
    if (existingMessage === undefined) {
      await this.messageStore.put(tenant, message, indexes);
      await this.eventLog.append(tenant, messageCid);
    }

    return {
      status: { code: 202, detail: 'Accepted' }
    };
  }
}