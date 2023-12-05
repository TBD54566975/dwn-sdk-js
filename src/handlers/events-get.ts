import type { DidResolver } from '../did/did-resolver.js';
import type { EventLog } from '../types/event-log.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { EventsGetMessage, EventsGetReply } from '../types/event-types.js';

import { EventsGet } from '../interfaces/events-get.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { authenticate, authorize } from '../core/auth.js';

type HandleArgs = {tenant: string, message: EventsGetMessage};

export class EventsGetHandler implements MethodHandler {
  constructor(private didResolver: DidResolver, private eventLog: EventLog) {}

  public async handle({ tenant, message }: HandleArgs): Promise<EventsGetReply> {
    let eventsGet: EventsGet;

    try {
      eventsGet = await EventsGet.parse(message);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }

    try {
      await authenticate(message.authorization, this.didResolver);
      await authorize(tenant, eventsGet);
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    // if a cursor was provided in message, get all events _after_ the cursor.
    // Otherwise, get all events.
    const { cursor: queryCursor } = message.descriptor;
    const { entries: events, cursor } = await this.eventLog.getEvents(tenant, queryCursor);

    return {
      status: { code: 200, detail: 'OK' },
      events,
      cursor
    };
  }
}