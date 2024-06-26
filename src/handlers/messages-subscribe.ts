import type { DidResolver } from '@web5/dids';
import type { MessageStore } from '../types/message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { EventListener, EventStream } from '../types/subscriptions.js';
import type { MessagesSubscribeMessage, MessagesSubscribeReply, MessageSubscriptionHandler } from '../types/messages-types.js';

import { authenticate } from '../core/auth.js';
import { FilterUtility } from '../utils/filter.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { Messages } from '../utils/messages.js';
import { MessagesGrantAuthorization } from '../core/messages-grant-authorization.js';
import { MessagesSubscribe } from '../interfaces/messages-subscribe.js';
import { PermissionsProtocol } from '../protocols/permissions.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

export class MessagesSubscribeHandler implements MethodHandler {
  constructor(
    private didResolver: DidResolver,
    private messageStore: MessageStore,
    private eventStream?: EventStream
  ) {}

  public async handle({
    tenant,
    message,
    subscriptionHandler
  }: {
    tenant: string;
    message: MessagesSubscribeMessage;
    subscriptionHandler: MessageSubscriptionHandler;
  }): Promise<MessagesSubscribeReply> {
    if (this.eventStream === undefined) {
      return messageReplyFromError(new DwnError(
        DwnErrorCode.MessagesSubscribeEventStreamUnimplemented,
        'Subscriptions are not supported'
      ), 501);
    }

    let messagesSubscribe: MessagesSubscribe;
    try {
      messagesSubscribe = await MessagesSubscribe.parse(message);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }

    try {
      await authenticate(message.authorization, this.didResolver);
      await MessagesSubscribeHandler.authorizeMessagesSubscribe(tenant, messagesSubscribe, this.messageStore);
    } catch (error) {
      return messageReplyFromError(error, 401);
    }

    const { filters } = message.descriptor;
    const messagesFilters = Messages.convertFilters(filters);
    const messageCid = await Message.getCid(message);

    const listener: EventListener = (eventTenant, event, eventIndexes):void => {
      if (tenant === eventTenant && FilterUtility.matchAnyFilter(eventIndexes, messagesFilters)) {
        subscriptionHandler(event);
      }
    };

    const subscription = await this.eventStream.subscribe(tenant, messageCid, listener);

    return {
      status: { code: 200, detail: 'OK' },
      subscription,
    };
  }

  private static async authorizeMessagesSubscribe(tenant: string, messagesSubscribe: MessagesSubscribe, messageStore: MessageStore): Promise<void> {
    // if `MessagesSubscribe` author is the same as the target tenant, we can directly grant access
    if (messagesSubscribe.author === tenant) {
      return;
    } else if (messagesSubscribe.author !== undefined && messagesSubscribe.signaturePayload!.permissionGrantId !== undefined) {
      const permissionGrant = await PermissionsProtocol.fetchGrant(tenant, messageStore, messagesSubscribe.signaturePayload!.permissionGrantId);
      await MessagesGrantAuthorization.authorizeQueryOrSubscribe({
        incomingMessage : messagesSubscribe.message,
        expectedGrantor : tenant,
        expectedGrantee : messagesSubscribe.author,
        permissionGrant,
        messageStore
      });
    } else {
      throw new DwnError(DwnErrorCode.MessagesSubscribeAuthorizationFailed, 'message failed authorization');
    }
  }
}
