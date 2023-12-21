import EventEmitter from 'events';

import type { DidResolver } from '../did/did-resolver.js';
import type { Filter } from '../types/query-types.js';
import type { GenericMessageHandler } from '../types/message-types.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { EventListener, EventStream } from '../types/subscriptions.js';
import type { EventsSubscribeMessage, EventsSubscribeReply, EventsSubscription } from '../types/events-types.js';

import { Events } from '../utils/events.js';
import { EventsSubscribe } from '../interfaces/events-subscribe.js';
import { FilterUtility } from '../utils/filter.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { authenticate, authorizeOwner } from '../core/auth.js';

export class EventsSubscribeHandler implements MethodHandler {
  constructor(
    private didResolver: DidResolver,
    private eventStream: EventStream
  ) {}

  public async handle({
    tenant,
    message,
    handler,
  }: {
    tenant: string;
    message: EventsSubscribeMessage;
    handler: GenericMessageHandler;
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
      const messageCid = await Message.getCid(message);
      const subscription = await this.createEventSubscription(tenant, messageCid, handler, eventsFilters);

      const messageReply: EventsSubscribeReply = {
        status: { code: 200, detail: 'OK' },
        subscription,
      };
      return messageReply;
    } catch (error) {
      return messageReplyFromError(error, 401);
    }
  }

  /**
   * Creates an EventStream subscription and assigns the message handler to the listener.
   * The listener checks that the incoming message matches the supplied filters, as well as is attributed to the tenant.
   */
  private async createEventSubscription(
    tenant: string,
    messageCid: string,
    handler: GenericMessageHandler,
    filters: Filter[]
  ): Promise<EventsSubscription> {

    const eventEmitter = new EventEmitter();
    const eventChannel = `${tenant}_${messageCid}`;

    const listener: EventListener = (eventTenant, eventMessage, eventIndexes):void => {
      if (tenant === eventTenant && FilterUtility.matchAnyFilter(eventIndexes, filters)) {
        eventEmitter.emit(eventChannel, eventMessage);
      }
    };

    const eventsSubscription = await this.eventStream.subscribe(messageCid, listener);
    eventEmitter.on(eventChannel, handler);

    return {
      id    : messageCid,
      close : async (): Promise<void> => {
        await eventsSubscription.close();
        eventEmitter.off(eventChannel, handler);
      },
    };
  }
}
