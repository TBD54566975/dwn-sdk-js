import type { Filter } from '../index.js';
import type { RangeFilter } from '../types/message-types.js';
import type { Signer } from '../types/signer.js';
import type { EventsFilter, EventsQueryDescriptor, EventsQueryMessage } from '../types/event-types.js';

import { AbstractMessage } from '../core/abstract-message.js';
import { Message } from '../core/message.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { Time } from '../utils/time.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';
import { normalizeProtocolUrl, normalizeSchemaUrl } from '../utils/url.js';

export type EventsQueryOptions = {
  signer: Signer;
  filters: EventsFilter[];
  watermark?: string;
  messageTimestamp?: string;
};

export class EventsQuery extends AbstractMessage<EventsQueryMessage>{

  public static async parse(message: EventsQueryMessage): Promise<EventsQuery> {
    Message.validateJsonSchema(message);
    await Message.validateMessageSignatureIntegrity(message.authorization.signature, message.descriptor);

    return new EventsQuery(message);
  }

  public static async create(options: EventsQueryOptions): Promise<EventsQuery> {
    const descriptor: EventsQueryDescriptor = {
      interface        : DwnInterfaceName.Events,
      method           : DwnMethodName.Query,
      filters          : this.normalizeFilters(options.filters),
      messageTimestamp : options.messageTimestamp ?? Time.getCurrentTimestamp(),
      watermark        : options.watermark,
    };

    removeUndefinedProperties(descriptor);

    const authorization = await Message.createAuthorization({ descriptor, signer: options.signer });
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new EventsQuery(message);
  }

  private static normalizeFilters(filters: EventsFilter[]): EventsFilter[] {
    return filters.map(filter => {
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
    });
  }

  /**
 *  Converts an incoming RecordsFilter into a Filter usable by EventLog.
 *
 * @param filters An EventQueryFilter
 * @returns {EventsLogFilter} a generic Filter able to be used with EventLog query.
 */
  public static convertFilters(filters: EventsFilter[]): Filter[] {
    const eventLogFilters: Filter[] = [];

    for (const filter of filters) {
      const { dateCreated } = filter;

      // set a range filter for dates
      let rangeFilter: RangeFilter | undefined = undefined;
      if (dateCreated !== undefined) {
        if (dateCreated.to !== undefined && dateCreated.from !== undefined) {
          rangeFilter = {
            gte : dateCreated.from,
            lt  : dateCreated.to,
          };
        } else if (dateCreated.to !== undefined) {
          rangeFilter = {
            lt: dateCreated.to,
          };
        } else if (dateCreated.from !== undefined) {
          rangeFilter = {
            gte: dateCreated.from,
          };
        }
      }

      if (rangeFilter) {
        (filter as Filter).dateCreated = rangeFilter;
      }

      // add to event log filters array, sorted by the watermark property
      eventLogFilters.push(filter as Filter);
    }

    return eventLogFilters;
  }
}