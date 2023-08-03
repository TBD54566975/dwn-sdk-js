import type { GeneralJws } from './jws-types.js';

/**
 * Intersection type for all concrete message types.
 */
export type GenericMessage = {
  descriptor: Descriptor
  authorization?: GeneralJws;
};

/**
 * Type of common decoded `authorization`property payload.
 */
export type BaseAuthorizationPayload = {
  descriptorCid: string;
  permissionsGrantId?: string;
};

/**
 * Intersection type for all DWN message descriptor.
 */
export type Descriptor = {
  interface: string;
  method: string;
  messageTimestamp: string;

};

/**
 * Messages that have `messageTimestamp` in their `descriptor` property.
 */
export type TimestampedMessage = GenericMessage & {
  descriptor: {
    messageTimestamp: string;
  }
};

/**
 * Message returned in a query result.
 * NOTE: the message structure is a modified version of the message received, the most notable differences are:
 * 1. does not contain `authorization`
 * 2. may include encoded data
 */
export type QueryResultEntry = {
  descriptor: Descriptor;
  encodedData?: string;
};

export type EqualFilter = string | number | boolean;

export type OneOfFilter = EqualFilter[];

export type RangeValue = string | number;

/**
 * "greater than" or "greater than or equal to" range condition. `gt` and `gte` are mutually exclusive.
 */
export type GT = ({ gt: RangeValue } & { gte?: never }) | ({ gt?: never } & { gte: RangeValue });

/**
 * "less than" or "less than or equal to" range condition. `lt`, `lte` are mutually exclusive.
 */
export type LT = ({ lt: RangeValue } & { lte?: never }) | ({ lt?: never } & { lte: RangeValue });

/**
 * Ranger filter. 1 condition is required.
 */
export type RangeFilter = (GT | LT) & Partial<GT> & Partial<LT>;

export type Filter = {
  [property: string]: EqualFilter | OneOfFilter | RangeFilter
};
