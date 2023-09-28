import type { Signer } from '../types/signer.js';
import type { EventsFilter, EventsQueryDescriptor, EventsQueryMessage } from '../types/event-types.js';

import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { validateAuthorizationIntegrity } from '../core/auth.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';
import { normalizeProtocolUrl, normalizeSchemaUrl } from '../utils/url.js';

export type EventsQueryOptions = {
  filter: EventsFilter;
  authorizationSigner: Signer;
  messageTimestamp?: string;
};

export class EventsQuery extends Message<EventsQueryMessage> {

  public static async parse(message: EventsQueryMessage): Promise<EventsQuery> {
    Message.validateJsonSchema(message);
    await validateAuthorizationIntegrity(message);

    return new EventsQuery(message);
  }

  public static async create(options: EventsQueryOptions): Promise<EventsQuery> {
    const descriptor: EventsQueryDescriptor = {
      interface        : DwnInterfaceName.Events,
      method           : DwnMethodName.Query,
      filter           : this.normalizeFilter(options.filter),
      messageTimestamp : options.messageTimestamp ?? getCurrentTimeInHighPrecision(),
    };
    console.log('descriptor', descriptor);
    const authorization = await Message.signAuthorizationAsAuthor(descriptor, options.authorizationSigner);
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new EventsQuery(message);
  }

  private static normalizeFilter(filter: EventsFilter): EventsFilter {
    const normalizedFilter = {
      ...filter,
    };

    if (filter.protocol !== undefined) {
      normalizedFilter.protocol = normalizeProtocolUrl(filter.protocol);
    }

    if (filter.schema !== undefined) {
      normalizedFilter.schema = normalizeSchemaUrl(filter.schema);
    }

    return normalizedFilter;
  }
}