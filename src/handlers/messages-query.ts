import type { DidResolver } from '@web5/dids';
import type { EventLog } from '../types/event-log.js';
import type { MessageStore } from '../types/message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { MessagesQueryMessage, MessagesQueryReply } from '../types/messages-types.js';

import { authenticate } from '../core/auth.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { Messages } from '../utils/messages.js';
import { MessagesGrantAuthorization } from '../core/messages-grant-authorization.js';
import { MessagesQuery } from '../interfaces/messages-query.js';
import { PermissionsProtocol } from '../protocols/permissions.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';


export class MessagesQueryHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private messageStore: MessageStore, private eventLog: EventLog) { }

  public async handle({
    tenant,
    message
  }: {tenant: string, message: MessagesQueryMessage}): Promise<MessagesQueryReply> {
    let messagesQuery: MessagesQuery;

    try {
      messagesQuery = await MessagesQuery.parse(message);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }

    try {
      await authenticate(message.authorization, this.didResolver);
      await MessagesQueryHandler.authorizeMessagesQuery(tenant, messagesQuery, this.messageStore);
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    // an empty array of filters means no filtering and all events are returned
    const eventFilters = Messages.convertFilters(message.descriptor.filters);
    const { events, cursor } = await this.eventLog.queryEvents(tenant, eventFilters, message.descriptor.cursor);

    return {
      status  : { code: 200, detail: 'OK' },
      entries : events,
      cursor
    };
  }

  private static async authorizeMessagesQuery(tenant: string, messagesQuery: MessagesQuery, messageStore: MessageStore): Promise<void> {
    // if `MessagesQuery` author is the same as the target tenant, we can directly grant access
    if (messagesQuery.author === tenant) {
      return;
    } else if (messagesQuery.author !== undefined && messagesQuery.signaturePayload!.permissionGrantId !== undefined) {
      const permissionGrant = await PermissionsProtocol.fetchGrant(tenant, messageStore, messagesQuery.signaturePayload!.permissionGrantId);
      await MessagesGrantAuthorization.authorizeQueryOrSubscribe({
        incomingMessage : messagesQuery.message,
        expectedGrantor : tenant,
        expectedGrantee : messagesQuery.author,
        permissionGrant,
        messageStore
      });
    } else {
      throw new DwnError(DwnErrorCode.MessagesQueryAuthorizationFailed, 'message failed authorization');
    }
  }
}
