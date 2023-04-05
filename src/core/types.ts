import type { GeneralJws } from '../jose/jws/general/types.js';

/**
 * Intersection type for all concrete message types.
 */
export type BaseMessage = {
  descriptor: Descriptor
  authorization?: GeneralJws;
};

/**
 * Type of common decoded `authorization`property payload.
 */
export type BaseDecodedAuthorizationPayload = {
  descriptorCid: string;
};

/**
 * Intersection type for all DWN message descriptor.
 */
export type Descriptor = {
  interface: string;
  method: string;
  dataCid?: string;
  dataSize?: number;
};

/**
 * Messages that have `dateModified` in their `descriptor` property.
 */
export type TimestampedMessage = BaseMessage & {
  descriptor: {
    dateModified: string;
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

/**
 * "greater than" or "greater than or equal to" range condition. `gt` and `gte` are mutually exclusive.
 */
export type GT = ({ gt: string } & { gte?: never }) | ({ gt?: never } & { gte: string });

/**
 * "less than" or "less than or equal to" range condition. `lt`, `lte` are mutually exclusive.
 */
export type LT = ({ lt: string } & { lte?: never }) | ({ lt?: never } & { lte: string });

/**
 * Ranger filter. 1 condition is required.
 */
export type RangeFilter = (GT | LT) & Partial<GT> & Partial<LT>;

export type Filter = {
  [property: string]: EqualFilter | OneOfFilter | RangeFilter
};
