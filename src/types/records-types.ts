import type { DateSort } from '../interfaces/records-query.js';
import type { EncryptionAlgorithm } from '../utils/encryption.js';
import type { GeneralJws } from './jws-types.js';
import type { GenericMessageReply } from '../core/message-reply.js';
import type { KeyDerivationScheme } from '../utils/hd-key.js';
import type { PublicJwk } from './jose-types.js';
import type { Readable } from 'readable-stream';
import type { BaseAuthorizationPayload, GenericMessage } from './message-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../core/message.js';

export type RecordsWriteDescriptor = {
  interface: DwnInterfaceName.Records;
  method: DwnMethodName.Write;
  protocol?: string;
  protocolPath?: string;
  recipient?: string;
  schema?: string;
  parentId?: string;
  commitStrategy?: CommitStrategy;
  dataCid: string;
  dataSize: number;
  dateCreated: string;
  messageTimestamp: string;
  published?: boolean;
  datePublished?: string;
  dataFormat: string;
};

export type RecordsWriteMessage = GenericMessage & {
  recordId: string,
  contextId?: string;
  descriptor: RecordsWriteDescriptor;
  attestation?: GeneralJws;
  encryption?: EncryptionProperty;
};

export enum CommitStrategy {
  JSONPatch = 'json-patch',
  JSONMerge = 'json-merge'
};

export type RecordsCommitDescriptor = {
  interface: DwnInterfaceName.Records;
  method: DwnMethodName.Commit;
  parentId: string;
  recipient?: string;
  schema?: string;
  commitStrategy?: CommitStrategy;
  dataCid: string;
  dataSize: number;
  dateCreated: string;
  messageTimestamp: string;
  dataFormat: string;
};

export type RecordsCommitMessage = GenericMessage & {
  recordId: string
  contextId?: string;
  descriptor: RecordsCommitDescriptor;
  attestation?: GeneralJws;
  encryption?: EncryptionProperty;
};

/**
 * Input that describes how data is encrypted as spec-ed in TP18 (https://github.com/TBD54566975/technical-proposals/pull/6).
 */
export type EncryptionInput = {
  /**
   * Algorithm used for encrypting the Data. Uses {EncryptionAlgorithm.Aes256Ctr} if not given.
   */
  algorithm?: EncryptionAlgorithm;

  /**
   * Initialization vector used for encrypting the data.
   */
  initializationVector: Uint8Array;

  /**
   * Symmetric key used to encrypt the data.
   */
  key: Uint8Array;

  /**
   * Array of input that specifies how the symmetric key is encrypted.
   * Each entry in the array will result in a unique ciphertext of the symmetric key.
   */
  keyEncryptionInputs: KeyEncryptionInput[];
};

/**
 * Input that specifies how a symmetric key is encrypted.
 */
export type KeyEncryptionInput = {
  /**
   * Key derivation scheme to derive the descendant public key to encrypt the symmetric key.
   */
  derivationScheme: KeyDerivationScheme;

  /**
   * Fully qualified ID of root public key used derive the descendant public key to encrypt the symmetric key.
   * (e.g. did:example:abc#encryption-key-id)
   */
  publicKeyId: string;

  /**
   * Root public key used derive the descendant public key to encrypt the symmetric key.
   */
  publicKey: PublicJwk;

  /**
   * Algorithm used for encrypting the symmetric key. Uses {EncryptionAlgorithm.EciesSecp256k1} if not given.
   */
  algorithm?: EncryptionAlgorithm;
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
  messageTimestamp: string;
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

export type RecordsWriteAuthorizationPayload = BaseAuthorizationPayload & {
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
};

export type RecordsReadMessage = {
  authorization?: GeneralJws;
  descriptor: RecordsReadDescriptor;
};

export type RecordsReadReply = GenericMessageReply & {
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
  messageTimestamp: string;
};

export type RecordsDeleteMessage = GenericMessage & {
  descriptor: RecordsDeleteDescriptor;
};

export type RecordsDeleteDescriptor = {
  interface: DwnInterfaceName.Records;
  method: DwnMethodName.Delete;
  recordId: string;
  messageTimestamp: string;
};