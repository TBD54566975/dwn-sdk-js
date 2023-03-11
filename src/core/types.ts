import type { GeneralJws } from '../jose/jws/general/types.js';

/**
 * Intersection type for all concrete message types.
 */
export type BaseMessage = {
  descriptor: Descriptor
  authorization: GeneralJws;
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
 * Message that references `dataCid`.
 */
export type DataReferencingMessage = {
  descriptor: {
    dataCid: string;
  };

  encodedData: string;
};

export type EqualFilter = string | number | boolean;

export type OneOfFilter = EqualFilter[];

type GT = ({ gt: string } & { gte?: never }) | ({ gt?: never } & { gte: string });
type LT = ({ lt: string } & { lte?: never }) | ({ lt?: never } & { lte: string });
export type RangeFilter = (GT | LT) & Partial<GT> & Partial<LT>;

export type Filter = {
  [property: string]: EqualFilter | OneOfFilter | RangeFilter
};
