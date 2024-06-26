import type { DidResolver } from '@web5/dids';
import type { MessageStore } from '../types/message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { EventListener, EventStream } from '../types/subscriptions.js';
import type { EventsSubscribeMessage, EventsSubscribeReply, MessageSubscriptionHandler } from '../types/events-types.js';

import { authenticate } from '../core/auth.js';
import { Events } from '../utils/events.js';
import { EventsGrantAuthorization } from '../core/events-grant-authorization.js';
import { EventsSubscribe } from '../interfaces/events-subscribe.js';
import { FilterUtility } from '../utils/filter.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { PermissionsProtocol } from '../protocols/permissions.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

export class EventsSubscribeHandler implements MethodHandler {
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
    message: EventsSubscribeMessage;
    subscriptionHandler: MessageSubscriptionHandler;
  }): Promise<EventsSubscribeReply> {
    if (this.eventStream === undefined) {
      return messageReplyFromError(new DwnError(
        DwnErrorCode.EventsSubscribeEventStreamUnimplemented,
        'Subscriptions are not supported'
      ), 501);
    }

    let eventsSubscribe: EventsSubscribe;
    try {
      eventsSubscribe = await EventsSubscribe.parse(message);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }

    try {
      await authenticate(message.authorization, this.didResolver);
      await EventsSubscribeHandler.authorizeEventsSubscribe(tenant, eventsSubscribe, this.messageStore);
    } catch (error) {
      return messageReplyFromError(error, 401);
    }

    const { filters } = message.descriptor;
    const eventsFilters = Events.convertFilters(filters);
    const messageCid = await Message.getCid(message);

    const listener: EventListener = (eventTenant, event, eventIndexes):void => {
      if (tenant === eventTenant && FilterUtility.matchAnyFilter(eventIndexes, eventsFilters)) {
        subscriptionHandler(event);
      }
    };

    const subscription = await this.eventStream.subscribe(tenant, messageCid, listener);

    return {
      status: { code: 200, detail: 'OK' },
      subscription,
    };
  }

  private static async authorizeEventsSubscribe(tenant: string, eventsSubscribe: EventsSubscribe, messageStore: MessageStore): Promise<void> {
    // if `EventsSubscribe` author is the same as the target tenant, we can directly grant access
    if (eventsSubscribe.author === tenant) {
      return;
    } else if (eventsSubscribe.author !== undefined && eventsSubscribe.signaturePayload!.permissionGrantId !== undefined) {
      const permissionGrant = await PermissionsProtocol.fetchGrant(tenant, messageStore, eventsSubscribe.signaturePayload!.permissionGrantId);
      await EventsGrantAuthorization.authorizeQueryOrSubscribe({
        incomingMessage : eventsSubscribe.message,
        expectedGrantor : tenant,
        expectedGrantee : eventsSubscribe.author,
        permissionGrant,
        messageStore
      });
    } else {
      throw new DwnError(DwnErrorCode.EventsSubscribeAuthorizationFailed, 'message failed authorization');
    }
  }
}
