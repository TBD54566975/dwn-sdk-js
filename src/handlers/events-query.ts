import type { DidResolver } from '@web5/dids';
import type { EventLog } from '../types/event-log.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { EventsQueryMessage, EventsQueryReply } from '../types/events-types.js';

import { Events } from '../utils/events.js';
import { EventsQuery } from '../interfaces/events-query.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { authenticate, authorizeOwner } from '../core/auth.js';


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
      await authorizeOwner(tenant, eventsQuery);
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    const eventFilters = Events.convertFilters(message.descriptor.filters);
    const { events, cursor } = await this.eventLog.queryEvents(tenant, eventFilters, message.descriptor.cursor);

    return {
      status  : { code: 200, detail: 'OK' },
      entries : events,
      cursor
    };
  }
}
