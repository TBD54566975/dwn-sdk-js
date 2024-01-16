import type { DidResolver } from '../did/did-resolver.js';
import type { GenericMessageSubscriptionHandler } from '../types/message-types.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { EventListener, EventStream } from '../types/subscriptions.js';
import type { EventsSubscribeMessage, EventsSubscribeReply } from '../types/events-types.js';

import { Events } from '../utils/events.js';
import { EventsSubscribe } from '../interfaces/events-subscribe.js';
import { FilterUtility } from '../utils/filter.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { authenticate, authorizeOwner } from '../core/auth.js';
import { DwnError, DwnErrorCode } from '../index.js';

export class EventsSubscribeHandler implements MethodHandler {
  constructor(
    private didResolver: DidResolver,
    private eventStream?: EventStream
  ) {}

  public async handle({
    tenant,
    message,
    handler
  }: {
    tenant: string;
    message: EventsSubscribeMessage;
    handler: GenericMessageSubscriptionHandler;
  }): Promise<EventsSubscribeReply> {
    if (this.eventStream === undefined) {
      return messageReplyFromError(new DwnError(
        DwnErrorCode.EventsSubscribeEventStreamUnimplemented,
        'Subscriptions are not supported'
      ), 501);
    }

    let subscriptionRequest: EventsSubscribe;
    try {
      subscriptionRequest = await EventsSubscribe.parse(message);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }

    try {
      await authenticate(message.authorization, this.didResolver);
      await authorizeOwner(tenant, subscriptionRequest);
    } catch (error) {
      return messageReplyFromError(error, 401);
    }

    try {
      const { filters } = message.descriptor;
      const eventsFilters = Events.convertFilters(filters);
      const messageCid = await Message.getCid(message);
      const listener: EventListener = (eventTenant, eventMessage, eventIndexes):void => {
        if (tenant === eventTenant && FilterUtility.matchAnyFilter(eventIndexes, eventsFilters)) {
          handler(eventMessage);
        }
      };
      const subscription = await this.eventStream.subscribe(messageCid, listener);

      const messageReply: EventsSubscribeReply = {
        status: { code: 200, detail: 'OK' },
        subscription,
      };

      return messageReply;
    } catch (error) {
      return messageReplyFromError(error, 400);
    }
  }
}