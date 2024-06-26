import type { Filter } from '../types/query-types.js';
import type { MessagesFilter } from '../types/messages-types.js';

import { FilterUtility } from '../utils/filter.js';
import { normalizeProtocolUrl } from './url.js';
import { PermissionsProtocol } from '../protocols/permissions.js';
import { Records } from '../utils/records.js';
import { isEmptyObject, removeUndefinedProperties } from './object.js';


/**
 * Class containing Events related utility methods.
 */
export class Events {
  /**
   * Normalizes/fixes the formatting of the given filters (such as URLs) so that they provide a consistent search experience.
   */
  public static normalizeFilters(filters: MessagesFilter[]): MessagesFilter[] {

    const messagesQueryFilters: MessagesFilter[] = [];

    // normalize each filter, and only add non-empty filters to the returned array
    for (const filter of filters) {
      // normalize the protocol URL if it exists
      const protocol = filter.protocol !== undefined ? normalizeProtocolUrl(filter.protocol) : undefined;

      const eventsFilter = {
        ...filter,
        protocol,
      };

      // remove any empty filter properties and do not add if empty
      removeUndefinedProperties(eventsFilter);
      if (!isEmptyObject(eventsFilter)) {
        messagesQueryFilters.push(eventsFilter);
      }
    }

    return messagesQueryFilters;
  }

  /**
   *  Converts an incoming array of EventsFilter into an array of Filter usable by EventLog.
   *
   * @param filters An array of EventsFilter
   * @returns {Filter[]} an array of generic Filter able to be used when querying.
   */
  public static convertFilters(filters: MessagesFilter[]): Filter[] {

    const messagesQueryFilters: Filter[] = [];

    // convert each filter individually by the specific type of filter it is
    // we must check for the type of filter in a specific order to make a reductive decision as to which filters need converting
    // first we check for `EventsRecordsFilter` fields for conversion
    // otherwise it is `EventsMessageFilter` fields for conversion
    for (const filter of filters) {
      // extract the protocol tag filter from the incoming event record filter
      // this filters for permission grants, requests and revocations associated with a targeted protocol
      // since permissions are their own protocol, we added an additional tag index when writing the permission messages
      // so that we can filter for permission records here
      const permissionRecordsFilter = this.constructPermissionRecordsFilter(filter);
      if (permissionRecordsFilter) {
        messagesQueryFilters.push(permissionRecordsFilter);
      }

      messagesQueryFilters.push(this.convertFilter(filter));
    }

    return messagesQueryFilters;
  }

  /**
   * Constructs a filter that gets associated permission records if protocol is in the given filter.
   */
  private static constructPermissionRecordsFilter(filter: MessagesFilter): Filter | undefined {
    const { protocol, messageTimestamp } = filter;
    if (protocol !== undefined) {
      const taggedFilter = {
        protocol: PermissionsProtocol.uri,
        ...Records.convertTagsFilter({ protocol })
      } as Filter;

      if (messageTimestamp != undefined) {
        // if we filter by message timestamp, we also want to filter the permission messages by the same timestamp range
        const messageTimestampFilter = FilterUtility.convertRangeCriterion(messageTimestamp);
        if (messageTimestampFilter) {
          taggedFilter.messageTimestamp = messageTimestampFilter;
        }
      }

      return taggedFilter;
    }
  }

  /**
   * Converts an external-facing filter model into an internal-facing filer model used by data store.
   */
  private static convertFilter(filter: MessagesFilter): Filter {
    const filterCopy = { ...filter } as Filter;

    const { messageTimestamp } = filter;
    const messageTimestampFilter = messageTimestamp ? FilterUtility.convertRangeCriterion(messageTimestamp) : undefined;
    if (messageTimestampFilter) {
      filterCopy.messageTimestamp = messageTimestampFilter;
      delete filterCopy.dateUpdated;
    }
    return filterCopy as Filter;
  }
}