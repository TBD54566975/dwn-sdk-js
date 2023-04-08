import type { DidResolver } from '../../../index.js';
import type { EventsGetMessage } from '../types.js';
import type { GetEventsOptions } from '../../../event-log/event-log.js';
import type { MethodHandler } from '../../types.js';
import type { Event, EventLog } from '../../../event-log/event-log.js';


import { authenticate } from '../../../core/auth.js';
import { EventsGet } from '../messages/events-get.js';
import { MessageReply } from '../../../core/message-reply.js';

type HandleArgs = {tenant: string, message: EventsGetMessage};

export class EventsGetHandler implements MethodHandler<Event> {
  constructor(private didResolver: DidResolver, private eventLog: EventLog) {}

  public async handle({ tenant, message }: HandleArgs): Promise<MessageReply<Event>> {
    let eventsGet: EventsGet;

    try {
      eventsGet = await EventsGet.parse(message);
    } catch (e) {
      return MessageReply.fromError(e, 400);
    }

    try {
      await authenticate(message.authorization, this.didResolver);

      if (eventsGet.author !== tenant) {
        //! FIXME: think of better error message
        throw new Error('message author must be tenant.');
      }
    } catch (e) {
      return MessageReply.fromError(e, 401);
    }

    // if watermark was provided in message, get all events _after_ the watermark. otherwise,
    // get all events.
    let options: GetEventsOptions | undefined;
    if (message.descriptor.watermark) {
      options = { gt: message.descriptor.watermark };
    }

    const events = await this.eventLog.getEvents(tenant, options);

    return {
      status  : { code: 200, detail: 'OK' },
      entries : events
    };
  }
}