import type { DidResolver } from '@web5/dids';
import type { MethodHandler } from '../types/method-handler.js';
import type { EventListener, EventStream } from '../types/subscriptions.js';
import type { EventsSubscribeMessage, EventsSubscribeReply, MessageSubscriptionHandler } from '../types/events-types.js';

import { Events } from '../utils/events.js';
import { EventsSubscribe } from '../interfaces/events-subscribe.js';
import { FilterUtility } from '../utils/filter.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { authenticate, authorizeOwner } from '../core/auth.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

export class EventsSubscribeHandler implements MethodHandler {
  constructor(
    private didResolver: DidResolver,
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
      await authorizeOwner(tenant, eventsSubscribe);
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
}
