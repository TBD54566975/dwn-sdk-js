import type { EventsLogFilter } from '../types/event-log.js';
import type { Filter } from '../index.js';
import type { RangeFilter } from '../types/message-types.js';
import type { Signer } from '../types/signer.js';
import type { EventsFilter, EventsQueryDescriptor, EventsQueryMessage } from '../types/event-types.js';

import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { SortOrder } from '../types/message-types.js';
import { validateMessageSignatureIntegrity } from '../core/auth.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';
import { normalizeProtocolUrl, normalizeSchemaUrl } from '../utils/url.js';

export type EventsQueryOptions = {
  filters: EventsFilter[];
  authorizationSigner: Signer;
  messageTimestamp?: string;
};

export class EventsQuery extends Message<EventsQueryMessage> {

  public static async parse(message: EventsQueryMessage): Promise<EventsQuery> {
    Message.validateJsonSchema(message);
    await validateMessageSignatureIntegrity(message.authorization.authorSignature, message.descriptor);

    return new EventsQuery(message);
  }

  public static async create(options: EventsQueryOptions): Promise<EventsQuery> {
    const descriptor: EventsQueryDescriptor = {
      interface        : DwnInterfaceName.Events,
      method           : DwnMethodName.Query,
      filters          : this.normalizeFilters(options.filters),
      messageTimestamp : options.messageTimestamp ?? getCurrentTimeInHighPrecision(),
    };

    removeUndefinedProperties(descriptor);

    const authorization = await Message.createAuthorizationAsAuthor(descriptor, options.authorizationSigner);
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
  public static convertFilters(filters: EventsFilter[]): EventsLogFilter[] {
    const eventLogFilters: EventsLogFilter[] = [];

    for (const filter of filters) {
      // remove watermark from the rest of the filter properties
      const { watermark, ...filterCopy } = { ...filter };
      const { dateCreated } = filterCopy;

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
        (filterCopy as Filter).dateCreated = rangeFilter;
      }

      // add to event log filters array, sorted by the watermark property
      eventLogFilters.push({ filter: filterCopy as Filter, sort: 'watermark', sortDirection: SortOrder.Ascending, cursor: watermark });
    }

    return eventLogFilters;
  }
}