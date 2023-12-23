import type { DelegatedGrantMessage } from '../types/delegated-grant-message.js';
import type { GeneralJws } from './jws-types.js';
import type { Readable } from 'readable-stream';
import type { PaginationCursor, SortDirection } from './query-types.js';

/**
 * Intersection type for all concrete message types.
 */
export type GenericMessage = {
  descriptor: Descriptor;
  authorization?: AuthorizationModel;
};

/**
 *  MessageOptions that are used when processing a message.
 */
export type MessageOptions = {
  dataStream?: Readable;
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
 * 1. May include encoded data
 */
export type QueryResultEntry = GenericMessage & {
  encodedData?: string;
};

export type GenericMessageHandler = (message: GenericMessage, updated?: boolean) => void;

export type GenericMessageSubscription = {
  id: string;
  on: (handler: GenericMessageHandler) => { off: () => void };
  close: () => Promise<void>;
};

/**
 * Pagination Options for querying messages.
 *
 * The cursor is the messageCid of the message you would like to pagination from.
 */
export type Pagination = {
  cursor?: PaginationCursor;
  limit?: number;
};

type Status = {
  code: number
  detail: string
};

export type GenericMessageReply = {
  status: Status;
};

export type MessageSort = {
  dateCreated?: SortDirection;
  datePublished?: SortDirection;
  messageTimestamp?: SortDirection;
};