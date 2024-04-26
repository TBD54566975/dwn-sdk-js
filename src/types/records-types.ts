import type { EncryptionAlgorithm } from '../utils/encryption.js';
import type { GeneralJws } from './jws-types.js';
import type { KeyDerivationScheme } from '../utils/hd-key.js';
import type { PublicJwk } from './jose-types.js';
import type { Readable } from 'readable-stream';
import type { AuthorizationModel, GenericMessage, GenericMessageReply, GenericSignaturePayload, MessageSubscription, Pagination } from './message-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';
import type { PaginationCursor, RangeCriterion, RangeFilter, StartsWithFilter } from './query-types.js';

export enum DateSort {
  CreatedAscending = 'createdAscending',
  CreatedDescending = 'createdDescending',
  PublishedAscending = 'publishedAscending',
  PublishedDescending = 'publishedDescending'
}

export type RecordsWriteTagValue = string | number | boolean | string[] | number[];
export type RecordsWriteTags = {
  [property: string]: RecordsWriteTagValue;
};

export type RecordsWriteTagsFilter = StartsWithFilter | RangeFilter | string | number | boolean;

export type RecordsWriteDescriptor = {
  interface: DwnInterfaceName.Records;
  method: DwnMethodName.Write;
  protocol?: string;
  protocolPath?: string;
  recipient?: string;
  schema?: string;
  tags?: RecordsWriteTags;
  parentId?: string;
  dataCid: string;
  dataSize: number;
  dateCreated: string;
  messageTimestamp: string;
  published?: boolean;
  datePublished?: string;
  dataFormat: string;
};

export type RecordsWriteMessageOptions = {
  dataStream?: Readable;
};

/**
 * Internal RecordsWrite message representation that can be in an incomplete state.
 */
export type InternalRecordsWriteMessage = GenericMessage & {
  recordId?: string,
  contextId?: string;
  descriptor: RecordsWriteDescriptor;
  attestation?: GeneralJws;
  encryption?: EncryptionProperty;
};

export type RecordsWriteMessage = {
  authorization: AuthorizationModel; // overriding `GenericMessage` with `authorization` being required
  recordId: string,
  contextId?: string;
  descriptor: RecordsWriteDescriptor;
  attestation?: GeneralJws;
  encryption?: EncryptionProperty;
};

export type EncryptionProperty = {
  algorithm: EncryptionAlgorithm;
  initializationVector: string;
  keyEncryption: EncryptedKey[]
};

export type EncryptedKey = {
  /**
   * The fully qualified key ID (e.g. did:example:abc#encryption-key-id) of the root public key used to encrypt the symmetric encryption key.
   */
  rootKeyId: string;

  /**
   * The actual derived public key.
   */
  derivedPublicKey?: PublicJwk;
  derivationScheme: KeyDerivationScheme;
  algorithm: EncryptionAlgorithm;
  initializationVector: string;
  ephemeralPublicKey: PublicJwk;
  messageAuthenticationCode: string;
  encryptedKey: string;
};

/**
 * Data structure returned in a `RecordsQuery` reply entry.
 * NOTE: the message structure is a modified version of the message received, the most notable differences are:
 * 1. May include an initial RecordsWrite message
 * 2. May include encoded data
 */
export type RecordsQueryReplyEntry = RecordsWriteMessage & {
  /**
   * The initial write of the record if the returned RecordsWrite message itself is not the initial write.
   */
  initialWrite?: RecordsWriteMessage;

  /**
   * The encoded data of the record if the data associated with the record is equal or smaller than `DwnConstant.maxDataSizeAllowedToBeEncoded`.
   */
  encodedData?: string;
};

/**
 * Represents a RecordsWrite message with encoded data attached.
 */
export type DataEncodedRecordsWriteMessage = RecordsWriteMessage & {
  /**
   * The encoded data of the record if the data associated with the record is equal or smaller than `DwnConstant.maxDataSizeAllowedToBeEncoded`.
   */
  encodedData?: string;
};

export type RecordsQueryDescriptor = {
  interface: DwnInterfaceName.Records;
  method: DwnMethodName.Query;
  messageTimestamp: string;
  filter: RecordsFilter;
  dateSort?: DateSort;
  pagination?: Pagination;
};

export type RecordsSubscribeDescriptor = {
  interface: DwnInterfaceName.Records;
  method: DwnMethodName.Subscribe;
  messageTimestamp: string;
  filter: RecordsFilter;
};

export type RecordsFilter = {
  /**
   * The logical author of the record
   */
  author?: string;
  attester?: string;
  recipient?: string;
  protocol?: string;
  protocolPath?: string;
  published?: boolean;

  /**
   * When given all Records message under the context of the given `contextId` will be returned.
   */
  contextId?: string;
  schema?: string;
  tags?: { [property:string]: RecordsWriteTagsFilter }
  recordId?: string;
  parentId?: string;
  dataFormat?: string;
  dataSize?: RangeFilter;
  dataCid?: string;
  dateCreated?: RangeCriterion;
  datePublished?: RangeCriterion;
  dateUpdated?: RangeCriterion;
};

export type RecordsWriteAttestationPayload = {
  descriptorCid: string;
};

export type RecordsWriteSignaturePayload = GenericSignaturePayload & {
  recordId: string;
  contextId?: string;
  attestationCid?: string;
  encryptionCid?: string;
};

export type RecordsQueryMessage = GenericMessage & {
  descriptor: RecordsQueryDescriptor;
};

export type RecordsQueryReply = GenericMessageReply & {
  entries?: RecordsQueryReplyEntry[];
  cursor?: PaginationCursor;
};

export type RecordEvent = {
  message: RecordsWriteMessage | RecordsDeleteMessage
  initialWrite?: RecordsWriteMessage;
};

export type RecordSubscriptionHandler = (event: RecordEvent) => void;

export type RecordsSubscribeMessageOptions = {
  subscriptionHandler: RecordSubscriptionHandler;
};

export type RecordsSubscribeMessage = GenericMessage & {
  descriptor: RecordsSubscribeDescriptor;
};

export type RecordsSubscribeReply = GenericMessageReply & {
  subscription?: MessageSubscription;
};

export type RecordsReadMessage = {
  authorization?: AuthorizationModel;
  descriptor: RecordsReadDescriptor;
};

export type RecordsReadReply = GenericMessageReply & {
  record?: RecordsWriteMessage & {
    /**
     * The initial write of the record if the returned RecordsWrite message itself is not the initial write.
     */
    initialWrite?: RecordsWriteMessage;
    data: Readable;
  };
};

export type RecordsReadDescriptor = {
  interface: DwnInterfaceName.Records;
  method: DwnMethodName.Read;
  filter: RecordsFilter;
  messageTimestamp: string;
};

export type RecordsDeleteMessage = GenericMessage & {
  authorization: AuthorizationModel; // overriding `GenericMessage` with `authorization` being required
  descriptor: RecordsDeleteDescriptor;
};

export type RecordsDeleteDescriptor = {
  interface: DwnInterfaceName.Records;
  method: DwnMethodName.Delete;
  messageTimestamp: string;
  recordId: string;

  /**
   * Denotes if all the descendent records should be purged.
   */
  prune: boolean
};