import type { DidResolver } from '../did/did-resolver.js';
import type EventEmitter from 'events';
import type { EventStream } from '../types/subscriptions.js';
import type { Filter } from '../types/query-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { EventsSubscribeMessage, EventsSubscribeReply } from '../types/events-types.js';

import { Events } from '../utils/events.js';
import { EventsSubscribe } from '../interfaces/events-subscribe.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { SubscriptionBase } from '../event-log/subscription.js';
import { authenticate, authorizeOwner } from '../core/auth.js';

export class EventsSubscribeHandler implements MethodHandler {
  constructor(
    private didResolver: DidResolver,
    private eventStream: EventStream
  ) {}

  public async handle({
    tenant,
    message,
  }: {
    tenant: string;
    message: EventsSubscribeMessage;
  }): Promise<EventsSubscribeReply> {
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
      const subscription = await this.eventStream.subscribe(tenant, message, eventsFilters);
      const messageReply: EventsSubscribeReply = {
        status: { code: 200, detail: 'OK' },
        subscription,
      };
      return messageReply;
    } catch (error) {
      return messageReplyFromError(error, 401);
    }
  }
}

export class EventsSubscriptionHandler extends SubscriptionBase {
  public static async create(input: {
    tenant: string,
    message: EventsSubscribeMessage,
    filters: Filter[],
    eventEmitter: EventEmitter,
    messageStore: MessageStore,
    unsubscribe: () => Promise<void>
  }): Promise<EventsSubscriptionHandler> {
    const id = await Message.getCid(input.message);
    return new EventsSubscriptionHandler({ ...input, id });
  }
};
