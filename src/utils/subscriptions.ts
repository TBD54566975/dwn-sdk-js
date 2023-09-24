import { SubscriptionFilter } from "../types/subscriptions-request.js";
import { normalizeProtocolUrl, normalizeSchemaUrl } from './url.js';

export class Subscriptions {
   
  /**
   * Normalizes the protocol and schema URLs within a provided SubscriptionFilter and returns a copy of SubscriptionFilter with the modified values.
   *
   * @param filter incoming SubscriptionFilter to normalize.
   * @returns {RecordsFilter} a copy of the incoming SubscriptionFilter with the normalized properties.
   */
  public static normalizeFilter(filter?: SubscriptionFilter): SubscriptionFilter {
    let protocol;
    if (filter?.protocol === undefined) {
      protocol = undefined;
    } else {
      protocol = normalizeProtocolUrl(filter.protocol);
    }

    let schema;
    if (filter?.schema === undefined) {
      schema = undefined;
    } else {
      schema = normalizeSchemaUrl(filter.schema);
    }

    return {
      ...filter,
      protocol,
      schema,
    };
  }
}