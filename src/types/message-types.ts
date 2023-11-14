import type { DelegatedGrantMessage } from '../types/delegated-grant-message.js';
import type { GeneralJws } from './jws-types.js';

/**
 * Intersection type for all concrete message types.
 */
export type GenericMessage = {
  descriptor: Descriptor;
  authorization?: AuthorizationModel;
};

/**
 * The data model for the `authorization` property in a DWN message.
 */
export type AuthorizationModel = {
  /**
   * The signature of the message signer.
   * NOTE: the signer is not necessarily the logical author of the message (e.g. signer is a delegate).
   */
  signature: GeneralJws;

  /**
   * The optional signature of a DWN owner wishing store a message authored by another entity.
   */
  ownerSignature?: GeneralJws;

  /**
   * The delegated grant invoked by a delegate, if the message is signed by a delegate.
   */
  authorDelegatedGrant?: DelegatedGrantMessage;
};

/**
 * Type of common decoded `authorization`property payload.
 */
export type GenericSignaturePayload = {
  descriptorCid: string;
  permissionsGrantId?: string;

  /**
   * CID of a `PermissionsGrant` DWN message with `delegated` set to `true`.
   */
  delegatedGrantId?: string;

  /**
   * Used in the Records interface to authorize role-authorized actions for protocol records.
   */
  protocolRole?: string;
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

/**
 * Pagination Options for querying messages.
 *
 * The cursor is the messageCid of the message you would like to pagination from.
 */
export type Pagination = {
  cursor?: string;
  limit?: number;
};

export enum SortOrder {
  Descending = -1,
  Ascending = 1
}

export type MessageSort = {
  dateCreated?: SortOrder;
  datePublished?: SortOrder;
  messageTimestamp?: SortOrder;
};