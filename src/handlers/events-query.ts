import type { DidResolver } from '@web5/dids';
import type { EventLog } from '../types/event-log.js';
import type { MessageStore } from '../types/message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { EventsQueryMessage, EventsQueryReply } from '../types/events-types.js';

import { authenticate } from '../core/auth.js';
import { Events } from '../utils/events.js';
import { EventsGrantAuthorization } from '../core/events-grant-authorization.js';
import { EventsQuery } from '../interfaces/events-query.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { PermissionsProtocol } from '../protocols/permissions.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';


export class EventsQueryHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private messageStore: MessageStore, private eventLog: EventLog) { }

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
      await EventsQueryHandler.authorizeEventsQuery(tenant, eventsQuery, this.messageStore);
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    // an empty array of filters means no filtering and all events are returned
    const eventFilters = Events.convertFilters(message.descriptor.filters);
    const { events, cursor } = await this.eventLog.queryEvents(tenant, eventFilters, message.descriptor.cursor);

    return {
      status  : { code: 200, detail: 'OK' },
      entries : events,
      cursor
    };
  }

  private static async authorizeEventsQuery(tenant: string, eventsQuery: EventsQuery, messageStore: MessageStore): Promise<void> {
    // if `EventsQuery` author is the same as the target tenant, we can directly grant access
    if (eventsQuery.author === tenant) {
      return;
    } else if (eventsQuery.author !== undefined && eventsQuery.signaturePayload!.permissionGrantId !== undefined) {
      const permissionGrant = await PermissionsProtocol.fetchGrant(tenant, messageStore, eventsQuery.signaturePayload!.permissionGrantId);
      await EventsGrantAuthorization.authorizeQuery({
        recordsWriteMessage : eventsQuery.message,
        expectedGrantor     : tenant,
        expectedGrantee     : eventsQuery.author,
        permissionGrant,
        messageStore
      });
    } else {
      throw new DwnError(DwnErrorCode.EventsQueryAuthorizationFailed, 'message failed authorization');
    }
  }
}
