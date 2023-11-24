import type { Filter } from '../types/query-types.js';
import type { ProtocolsQueryFilter } from '../types/protocols-types.js';
import type { Signer } from '../types/signer.js';
import type { EventsFilter, EventsQueryDescriptor, EventsQueryFilter, EventsQueryMessage, EventsRecordsFilter } from '../types/event-types.js';

import { AbstractMessage } from '../core/abstract-message.js';
import { FilterUtility } from '../utils/filter.js';
import { Message } from '../core/message.js';
import { ProtocolsQuery } from '../interfaces/protocols-query.js';
import { Records } from '../utils/records.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { Time } from '../utils/time.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export type EventsQueryOptions = {
  signer: Signer;
  filters: EventsQueryFilter[];
  cursor?: string;
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
      cursor           : options.cursor,
    };

    removeUndefinedProperties(descriptor);

    const authorization = await Message.createAuthorization({ descriptor, signer: options.signer });
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new EventsQuery(message);
  }

  private static normalizeFilters(filters: EventsQueryFilter[]): EventsQueryFilter[] {

    const eventsQueryFilters: EventsQueryFilter[] = [];

    // normalize each filter individually by the type of filter it is.
    for (const filter of filters) {
      if (this.isRecordsFilter(filter)) {
        eventsQueryFilters.push(Records.normalizeFilter(filter));
      } else if (this.isProtocolsFilter(filter)) {
        const protocolFilter = ProtocolsQuery.normalizeFilter(filter);
        eventsQueryFilters.push(protocolFilter!);
      } else {
        eventsQueryFilters.push(filter as EventsFilter);
      }
    }

    return eventsQueryFilters;
  }


  /**
   *  Converts an incoming array of EventsFilter into a Filter usable by EventLog.
   *
   * @param filters An array of EventsFilter
   * @returns {Filter[]} an array of generic Filter able to be used when querying.
   */
  public static convertFilters(filters: EventsQueryFilter[]): Filter[] {

    const eventsQueryFilters: Filter[] = [];

    // normalize each filter individually by the type of filter it is.
    for (const filter of filters) {
      if (this.isRecordsFilter(filter)) {
        eventsQueryFilters.push(Records.convertFilter(filter));
      } else if (this.isProtocolsFilter(filter)) {
        eventsQueryFilters.push({ ...filter });
      } else {
        eventsQueryFilters.push(this.convertFilter(filter));
      }
    }

    return eventsQueryFilters;
  }

  private static convertFilter(filter: EventsFilter): Filter {
    const filterCopy = { ...filter } as Filter;

    const { messageTimestamp } = filter;
    const messageTimestampFilter = messageTimestamp ? FilterUtility.convertRangeCriterion(messageTimestamp) : undefined;
    if (messageTimestampFilter) {
      filterCopy.messageTimestamp = messageTimestampFilter;
    }

    return filterCopy as Filter;
  }

  private static isProtocolsFilter(filter: EventsQueryFilter): filter is ProtocolsQueryFilter {
    return 'protocol' in filter;
  }

  private static isRecordsFilter(filter: EventsQueryFilter): filter is EventsRecordsFilter {
    return 'dateCreated' in filter ||
      'dataFormat' in filter ||
      'parentId' in filter ||
      'recordId' in filter ||
      'schema' in filter ||
      'protocolPath' in filter || // explicitly ignore `protocol` as it will be handled by the protocol filter
      'recipient' in filter;
  }

}