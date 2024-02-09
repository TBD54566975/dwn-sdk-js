import type { Filter } from '../types/query-types.js';
import type { EventsFilter, EventsMessageFilter, EventsRecordsFilter } from '../types/events-types.js';

import { FilterUtility } from '../utils/filter.js';
import { Records } from '../utils/records.js';
import { isEmptyObject, removeUndefinedProperties } from './object.js';


/**
 * Class containing Events related utility methods.
 */
export class Events {
  /**
   * Normalizes/fixes the formatting of the given filters (such as URLs) so that they provide a consistent search experience.
   */
  public static normalizeFilters(filters: EventsFilter[]): EventsFilter[] {

    const eventsQueryFilters: EventsFilter[] = [];

    // normalize each filter individually by the type of filter it is.
    for (const filter of filters) {
      let eventsFilter: EventsFilter;
      if (this.isRecordsFilter(filter)) {
        eventsFilter = Records.normalizeFilter(filter);
      } else {
        // no normalization needed
        eventsFilter = filter;
      }

      // remove any empty filter properties and do not add if empty
      removeUndefinedProperties(eventsFilter);
      if (!isEmptyObject(eventsFilter)) {
        eventsQueryFilters.push(eventsFilter);
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
    // otherwise it is `EventsMessageFilter` fields for conversion
    for (const filter of filters) {
      if (this.isRecordsFilter(filter)) {
        eventsQueryFilters.push(Records.convertFilter(filter));
      } else {
        eventsQueryFilters.push(this.convertFilter(filter));
      }
    }

    return eventsQueryFilters;
  }

  /**
   * Converts an external-facing filter model into an internal-facing filer model used by data store.
   */
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

  // we deliberately do not check for `dateUpdated` in this filter.
  // if it were the only property that matched, it could be handled by `EventsFilter`
  private static isRecordsFilter(filter: EventsFilter): filter is EventsRecordsFilter {
    return 'author' in filter ||
      'dateCreated' in filter ||
      'dataFormat' in filter ||
      'dataSize' in filter ||
      'parentId' in filter ||
      'recordId' in filter ||
      'schema' in filter ||
      'protocol' in filter ||
      'protocolPath' in filter ||
      'recipient' in filter;
  }
}