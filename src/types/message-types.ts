import type { GeneralJws } from './jws-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';
import type { PaginationCursor, SortDirection } from './query-types.js';

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
   * The delegated grant required when the message is signed by an author-delegate.
   */
  authorDelegatedGrant?: DelegatedGrantRecordsWriteMessage;

  /**
   * An "overriding" signature for a DWN owner or owner-delegate to store a message authored by another entity.
   */
  ownerSignature?: GeneralJws;

  /**
   * The delegated grant required when the message is signed by an owner-delegate.
   */
  ownerDelegatedGrant?: DelegatedGrantRecordsWriteMessage;
};

type DelegatedGrantRecordsWriteMessage = {
  authorization: {
    /**
     * The signature of the author.
     */
    signature: GeneralJws;
  },
  recordId: string,
  contextId?: string;
  // NOTE: This is a direct copy of `RecordsWriteDescriptor` to avoid circular references.
  descriptor: {
    interface: DwnInterfaceName.Records;
    method: DwnMethodName.Write;
    protocol?: string;
    protocolPath?: string;
    recipient?: string;
    schema?: string;
    parentId?: string;
    dataCid: string;
    dataSize: number;
    dateCreated: string;
    messageTimestamp: string;
    published?: boolean;
    datePublished?: string;
    dataFormat: string;
  };
};

/**
 * Type of common decoded `authorization` property payload.
 */
export type GenericSignaturePayload = {
  descriptorCid: string;
  permissionGrantId?: string;

  /**
   * Record ID of a permission grant DWN `RecordsWrite` with `delegated` set to `true`.
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

export interface MessageSubscription {
  id: string;
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