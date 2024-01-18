import type { Filter } from '../types/query-types.js';
import type { ProtocolsQueryFilter } from '../types/protocols-types.js';
import type { EventsFilter, EventsMessageFilter, EventsRecordsFilter } from '../types/events-types.js';

import { FilterUtility } from '../utils/filter.js';
import { ProtocolsQuery } from '../interfaces/protocols-query.js';
import { Records } from '../utils/records.js';


/**
 * Class containing Events related utility methods.
 */
export class Events {
  public static normalizeFilters(filters: EventsFilter[]): EventsFilter[] {

    const eventsQueryFilters: EventsFilter[] = [];

    // normalize each filter individually by the type of filter it is.
    for (const filter of filters) {
      if (this.isRecordsFilter(filter)) {
        eventsQueryFilters.push(Records.normalizeFilter(filter));
      } else if (this.isProtocolFilter(filter)) {
        eventsQueryFilters.push(ProtocolsQuery.normalizeFilter(filter));
      } else {
        // no normalization needed
        eventsQueryFilters.push(filter);
      }
    }

    return eventsQueryFilters;
  }

  /**
   *  Converts an incoming array of EventsFilter into an array of Filter usable by EventLog.
   *
   * @param filters An array of EventsFilter
   * @returns {Filter[]} an array of generic Filter able to be used when querying.
   */
  public static convertFilters(filters: EventsFilter[]): Filter[] {

    const eventsQueryFilters: Filter[] = [];

    // convert each filter individually by the specific type of filter it is
    // we must check for the type of filter in a specific order to make a reductive decision as to which filters need converting
    // first we check for `EventsRecordsFilter` fields for conversion
    // then we check for the `EventsMessageFilter` fields for conversion
    // finally we pass through the filters as `ProtocolQueryFilter` does not require conversion
    for (const filter of filters) {
      if (this.isRecordsFilter(filter)) {
        eventsQueryFilters.push(Records.convertFilter(filter));
      } else if (this.isMessagesFilter(filter)) {
        eventsQueryFilters.push(this.convertFilter(filter));
      } else {
        // protocol filters do not need any conversion
        eventsQueryFilters.push(filter);
      }
    }

    return eventsQueryFilters;
  }

  private static convertFilter(filter: EventsMessageFilter): Filter {
    const filterCopy = { ...filter } as Filter;

    const { dateUpdated } = filter;
    const messageTimestampFilter = dateUpdated ? FilterUtility.convertRangeCriterion(dateUpdated) : undefined;
    if (messageTimestampFilter) {
      filterCopy.messageTimestamp = messageTimestampFilter;
      delete filterCopy.dateUpdated;
    }
    return filterCopy as Filter;
  }

  private static isMessagesFilter(filter: EventsFilter): filter is EventsMessageFilter {
    return 'method' in filter || 'interface' in filter || 'dateUpdated' in filter;
  }

  // we deliberately do not check for `dateUpdated` in this filter.
  // if it were the only property that matched, it could be handled by `EventMessageFilter`
  private static isRecordsFilter(filter: EventsFilter): filter is EventsRecordsFilter {
    return 'author' in filter ||
      'dateCreated' in filter ||
      'dataFormat' in filter ||
      'dataSize' in filter ||
      'parentId' in filter ||
      'recordId' in filter ||
      'schema' in filter ||
      ('protocolPath' in filter && 'protocol' in filter) ||
      'recipient' in filter;
  }

  private static isProtocolFilter(filter: EventsFilter): filter is ProtocolsQueryFilter {
    return 'protocol' in filter;
  }
}