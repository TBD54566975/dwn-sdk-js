import type { BaseMessage } from './message-types.js';
import type { BaseMessageReply } from '../core/message-reply.js';
import type { DateSort } from '../interfaces/records-query.js';
import type { EncryptionAlgorithm } from '../utils/encryption.js';
import type { GeneralJws } from './jws-types.js';
import type { KeyDerivationScheme } from '../utils/hd-key.js';
import type { PublicJwk } from './jose-types.js';
import type { Readable } from 'readable-stream';
import type { DwnInterfaceName, DwnMethodName } from '../core/message.js';

export type RecordsWriteDescriptor = {
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
  dateModified: string;
  published?: boolean;
  datePublished?: string;
  dataFormat: string;
};

export type RecordsWriteMessage = BaseMessage & {
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
  derivationScheme: KeyDerivationScheme;
  algorithm: EncryptionAlgorithm;
  initializationVector: string;
  ephemeralPublicKey: PublicJwk;
  messageAuthenticationCode: string;
  encryptedKey: string;
};

export type UnsignedRecordsWriteMessage = {
  recordId: string,
  contextId?: string;
  descriptor: RecordsWriteDescriptor;
  encryption?: EncryptionProperty;
};

/**
 * Data structure returned in a `RecordsQuery` reply entry.
 * NOTE: the message structure is a modified version of the message received, the most notable differences are:
 * 1. does not contain `authorization`
 * 2. may include encoded data
 */
export type RecordsQueryReplyEntry = UnsignedRecordsWriteMessage & {
  encodedData?: string;
};

export type RecordsQueryDescriptor = {
  interface: DwnInterfaceName.Records;
  method: DwnMethodName.Query;
  dateCreated: string;
  filter: RecordsQueryFilter;
  dateSort?: DateSort;
};

export type RecordsQueryFilter = {
  attester?: string;
  recipient?: string;
  protocol?: string;
  protocolPath?: string;
  contextId?: string;
  schema?: string;
  recordId?: string;
  parentId?: string;
  dataFormat?: string;
  dateCreated?: RangeCriterion;
};

export type RangeCriterion = {
  /**
   * Inclusive starting date-time.
   */
  from?: string;

  /**
   * Inclusive end date-time.
   */
  to?: string;
};

export type RecordsWriteAttestationPayload = {
  descriptorCid: string;
};

export type RecordsWriteAuthorizationPayload = {
  recordId: string;
  contextId?: string;
  descriptorCid: string;
  attestationCid?: string;
  encryptionCid?: string;
};

export type RecordsQueryMessage = BaseMessage & {
  descriptor: RecordsQueryDescriptor;
};

export type RecordsQueryReply = BaseMessageReply & {
  entries?: RecordsQueryReplyEntry[];
};

export type RecordsReadMessage = {
  authorization?: GeneralJws;
  descriptor: RecordsReadDescriptor;
};

export type RecordsReadReply = BaseMessageReply & {
  record?: {
    recordId: string,
    contextId?: string;
    descriptor: RecordsWriteDescriptor;
    // authorization: GeneralJws; // intentionally omitted
    attestation?: GeneralJws;
    encryption?: EncryptionProperty;
    data: Readable;
  }
};

export type RecordsReadDescriptor = {
  interface: DwnInterfaceName.Records;
  method: DwnMethodName.Read;
  recordId: string;
  date: string;
};

export type RecordsDeleteMessage = BaseMessage & {
  descriptor: RecordsDeleteDescriptor;
};

export type RecordsDeleteDescriptor = {
  interface: DwnInterfaceName.Records;
  method: DwnMethodName.Delete;
  recordId: string;
  dateModified: string;
};