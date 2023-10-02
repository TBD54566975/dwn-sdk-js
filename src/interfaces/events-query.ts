import type { Filter } from '../index.js';
import type { QueryEventsFilter } from '../types/event-log.js';
import type { RangeFilter } from '../types/message-types.js';
import type { Signer } from '../types/signer.js';
import type { EventsQueryDescriptor, EventsQueryFilter, EventsQueryMessage } from '../types/event-types.js';

import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { validateMessageSignatureIntegrity } from '../core/auth.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';
import { normalizeProtocolUrl, normalizeSchemaUrl } from '../utils/url.js';

export type EventsQueryOptions = {
  filters: EventsQueryFilter[];
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

  private static normalizeFilters(filters: EventsQueryFilter[]): EventsQueryFilter[] {
    return filters.map(queryFilter => {
      const { filter, watermark } = queryFilter;
      const normalizedFilter = {
        ...filter,
      };

      if (filter.protocol !== undefined) {
        normalizedFilter.protocol = normalizeProtocolUrl(filter.protocol);
      }

      if (filter.schema !== undefined) {
        normalizedFilter.schema = normalizeSchemaUrl(filter.schema);
      }

      return { filter: normalizedFilter, watermark };
    });
  }

  /**
 *  Converts an incoming RecordsFilter into a Filter usable by EventLog.
 *
 * @param filters An EventQueryFilter
 * @returns {QueryEventsFilter} a generic Filter able to be used with EventLog query.
 */
  public static convertFilters(filters: EventsQueryFilter[]): QueryEventsFilter[] {
    const eventLogFilters: QueryEventsFilter[] = [];

    for (const queryFilter of filters) {
      const { filter, watermark } = queryFilter;
      const filterCopy = { ...filter };
      const { dateCreated } = filterCopy;

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

      eventLogFilters.push({ filter: filterCopy as Filter, gt: watermark });
    }

    return eventLogFilters;
  }
}