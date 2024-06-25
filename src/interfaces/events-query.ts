import type { PaginationCursor } from '../types/query-types.js';
import type { Signer } from '../types/signer.js';
import type { EventsFilter, EventsQueryDescriptor, EventsQueryMessage } from '../types/events-types.js';

import { AbstractMessage } from '../core/abstract-message.js';
import { Events } from '../utils/events.js';
import { Message } from '../core/message.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { Time } from '../utils/time.js';
import { validateProtocolUrlNormalized } from '../utils/url.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export type EventsQueryOptions = {
  signer: Signer;
  filters?: EventsFilter[];
  cursor?: PaginationCursor;
  messageTimestamp?: string;
  permissionGrantId?: string;
};

export class EventsQuery extends AbstractMessage<EventsQueryMessage>{

  public static async parse(message: EventsQueryMessage): Promise<EventsQuery> {
    Message.validateJsonSchema(message);
    await Message.validateSignatureStructure(message.authorization.signature, message.descriptor);

    for (const filter of message.descriptor.filters) {
      if ('protocol' in filter && filter.protocol !== undefined) {
        validateProtocolUrlNormalized(filter.protocol);
      }
    }

    return new EventsQuery(message);
  }

  public static async create(options: EventsQueryOptions): Promise<EventsQuery> {
    const descriptor: EventsQueryDescriptor = {
      interface        : DwnInterfaceName.Events,
      method           : DwnMethodName.Query,
      filters          : options.filters ? Events.normalizeFilters(options.filters) : [],
      messageTimestamp : options.messageTimestamp ?? Time.getCurrentTimestamp(),
      cursor           : options.cursor,
    };

    removeUndefinedProperties(descriptor);

    const { permissionGrantId, signer } = options;
    const authorization = await Message.createAuthorization({
      descriptor,
      signer,
      permissionGrantId
    });

    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new EventsQuery(message);
  }
}