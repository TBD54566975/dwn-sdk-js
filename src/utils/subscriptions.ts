import type { EventType } from '../types/event-types.js';
import type { SubscriptionFilter } from '../types/subscriptions-request.js';

import { normalizeProtocolUrl, normalizeSchemaUrl } from './url.js';

export class Subscriptions {

  /**
   * Normalizes the protocol and schema URLs within a provided SubscriptionFilter and returns a copy of SubscriptionFilter with the modified values.
   *
   * @param filter incoming SubscriptionFilter to normalize.
   * @returns {SubscriptionFilter} a copy of the incoming SubscriptionFilter with the normalized properties.
   */
  public static normalizeFilter(filter?: SubscriptionFilter): SubscriptionFilter {
    let protocol;
    if (filter?.recordFilters?.protocol === undefined) {
      protocol = undefined;
    } else {
      protocol = normalizeProtocolUrl(filter.recordFilters.protocol);
    }

    let schema;
    if (filter?.recordFilters?.schema === undefined) {
      schema = undefined;
    } else {
      schema = normalizeSchemaUrl(filter.recordFilters.schema);
    }

    const recordFilters = {
      ...filter?.recordFilters,
      protocol,
      schema,

    };
    return {
      ...filter,
      recordFilters,
      eventType: filter?.eventType as EventType
    };
  }
}