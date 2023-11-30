import type { DidResolver } from '../did/did-resolver.js';
import type { EventLog } from '../types/event-log.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { EventsQueryMessage, EventsQueryReply } from '../types/event-types.js';

import { EventsQuery } from '../interfaces/events-query.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { authenticate, authorize } from '../core/auth.js';


export class EventsQueryHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private eventLog: EventLog) { }

  public async handle({
    tenant,
    message
  }: {tenant: string, message: EventsQueryMessage}): Promise<EventsQueryReply> {
    let eventsQuery: EventsQuery;

    try {
      eventsQuery = await EventsQuery.parse(message);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }

    try {
      await authenticate(message.authorization, this.didResolver);
      await authorize(tenant, eventsQuery);
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    const { filters, cursor } = eventsQuery.message.descriptor;
    const logFilters = EventsQuery.convertFilters(filters);
    const { entries: events } = await this.eventLog.queryEvents(tenant, logFilters, cursor);

    return {
      status: { code: 200, detail: 'OK' },
      events
    };
  }
}
