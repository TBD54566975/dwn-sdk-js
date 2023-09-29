import type { DidResolver } from '../index.js';
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

    const { filter, watermark } = eventsQuery.message.descriptor;
    const logFilter = EventsQuery.convertFilter(filter);

    const events = await this.eventLog.query(tenant, [ logFilter ], watermark);

    return {
      status: { code: 200, detail: 'OK' },
      events
    };
  }
}
