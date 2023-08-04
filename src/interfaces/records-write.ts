import type { GenericMessage } from '../types/message-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { PublicJwk } from '../types/jose-types.js';
import type {
  EncryptedKey,
  EncryptionProperty,
  InternalRecordsWriteMessage,
  RecordsWriteAttestationPayload,
  RecordsWriteAuthorizationPayload,
  RecordsWriteDescriptor,
  RecordsWriteMessage,
  UnsignedRecordsWriteMessage
} from '../types/records-types.js';
import type { GeneralJws, SignatureInput } from '../types/jws-types.js';

import { Cid } from '../utils/cid.js';
import { Encoder } from '../utils/encoder.js';
import { Encryption } from '../utils/encryption.js';
import { EncryptionAlgorithm } from '../utils/encryption.js';
import { GeneralJwsSigner } from '../jose/jws/general/signer.js';
import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { Jws } from '../utils/jws.js';
import { KeyDerivationScheme } from '../index.js';
import { Message } from '../core/message.js';
import { ProtocolAuthorization } from '../core/protocol-authorization.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { Secp256k1 } from '../utils/secp256k1.js';

import { authorize, validateAuthorizationIntegrity } from '../core/auth.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../core/message.js';
import { normalizeProtocolUrl, normalizeSchemaUrl, validateProtocolUrlNormalized, validateSchemaUrlNormalized } from '../utils/url.js';

export type RecordsWriteOptions = {
  recipient?: string;
  protocol?: string;
  protocolPath?: string;
  contextId?: string;
  schema?: string;
  recordId?: string;
  parentId?: string;
  data?: Uint8Array;
  dataCid?: string;
  dataSize?: number;
  dateCreated?: string;
  messageTimestamp?: string;
  published?: boolean;
  datePublished?: string;
  dataFormat: string;
  authorizationSignatureInput?: SignatureInput;
  attestationSignatureInputs?: SignatureInput[];
  encryptionInput?: EncryptionInput;
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
   * Key derivation scheme used to derive the public key to encrypt the symmetric key.
   */
  derivationScheme: KeyDerivationScheme;

  /**
   * Fully qualified ID of root public key used derive the public key to be used to to encrypt the symmetric key.
   * (e.g. did:example:abc#encryption-key-id)
   */
  publicKeyId: string;

  /**
   * Public key to be used to encrypt the symmetric key.
   */
  publicKey: PublicJwk;

  /**
   * Algorithm used for encrypting the symmetric key. Uses {EncryptionAlgorithm.EciesSecp256k1} if not given.
   */
  algorithm?: EncryptionAlgorithm;
};

export type CreateFromOptions = {
  unsignedRecordsWriteMessage: UnsignedRecordsWriteMessage,
  data?: Uint8Array;
  published?: boolean;
  messageTimestamp?: string;
  datePublished?: string;
  authorizationSignatureInput?: SignatureInput;
  attestationSignatureInputs?: SignatureInput[];
  encryptionInput?: EncryptionInput;
};

export class RecordsWrite {
  private _message: InternalRecordsWriteMessage;
  /**
   * Valid JSON message representing this RecordsWrite.
   * @throws `DwnErrorCode.RecordsWriteMissingAuthorizationSignatureInput` if the message is not signed yet.
   */
  public get message(): RecordsWriteMessage {
    if (this._message.authorization === undefined) {
      throw new DwnError(
        DwnErrorCode.RecordsWriteMissingAuthorizationSignatureInput,
        'This RecordsWrite is not yet signed, JSON message cannot be generated from an incomplete state.'
      );
    }

    return this._message as RecordsWriteMessage;
  }

  private _author: string | undefined;
  /**
   * DID of author of this message.
   */
  public get author(): string | undefined {
    return this._author;
  }

  private _authorizationPayload: RecordsWriteAuthorizationPayload | undefined;
  /**
   * Decoded authorization payload.
   */
  public get authorizationPayload(): RecordsWriteAuthorizationPayload | undefined {
    return this._authorizationPayload;
  }

  readonly attesters: string[];

  private constructor(message: InternalRecordsWriteMessage) {
    this._message = message;

    if (message.authorization !== undefined) {
      this._authorizationPayload = Jws.decodePlainObjectPayload(message.authorization);
      this._author = Message.getAuthor(message as GenericMessage);
    }

    this.attesters = RecordsWrite.getAttesters(message);

    // consider converting isInitialWrite() & getEntryId() into properties for performance and convenience
  }

  public static async parse(message: RecordsWriteMessage): Promise<RecordsWrite> {
    // asynchronous checks that are required by the constructor to initialize members properly
    await validateAuthorizationIntegrity(message, 'RecordsWriteAuthorizationPayload');
    await RecordsWrite.validateAttestationIntegrity(message);

    const recordsWrite = new RecordsWrite(message);

    await recordsWrite.validateIntegrity(); // RecordsWrite specific data integrity check

    return recordsWrite;
  }

  /**
   * Creates a RecordsWrite message.
   * @param options.recordId If `undefined`, will be auto-filled as a originating message as convenience for developer.
   * @param options.data Data used to compute the `dataCid`, must be the encrypted data bytes if `options.encryptionInput` is given.
   *                     Must specify `options.dataCid` if `undefined`.
   * @param options.dataCid CID of the data that is already stored in the DWN. Must specify `options.data` if `undefined`.
   * @param options.dataSize Size of data in number of bytes. Must be defined if `options.dataCid` is defined; must be `undefined` otherwise.
   * @param options.dateCreated If `undefined`, it will be auto-filled with current time.
   * @param options.messageTimestamp If `undefined`, it will be auto-filled with current time.
   */
  public static async create(options: RecordsWriteOptions): Promise<RecordsWrite> {
    if ((options.protocol === undefined && options.protocolPath !== undefined) ||
        (options.protocol !== undefined && options.protocolPath === undefined)) {
      throw new Error('`protocol` and `protocolPath` must both be defined or undefined at the same time');
    }

    if ((options.data === undefined && options.dataCid === undefined) ||
        (options.data !== undefined && options.dataCid !== undefined)) {
      throw new Error('one and only one parameter between `data` and `dataCid` is allowed');
    }

    if ((options.dataCid === undefined && options.dataSize !== undefined) ||
        (options.dataCid !== undefined && options.dataSize === undefined)) {
      throw new Error('`dataCid` and `dataSize` must both be defined or undefined at the same time');
    }

    if (options.parentId !== undefined && options.contextId === undefined) {
      throw new Error('`contextId` must also be given when `parentId` is specified');
    }

    const dataCid = options.dataCid ?? await Cid.computeDagPbCidFromBytes(options.data!);
    const dataSize = options.dataSize ?? options.data!.length;

    const currentTime = getCurrentTimeInHighPrecision();

    const descriptor: RecordsWriteDescriptor = {
      interface        : DwnInterfaceName.Records,
      method           : DwnMethodName.Write,
      protocol         : options.protocol !== undefined ? normalizeProtocolUrl(options.protocol) : undefined,
      protocolPath     : options.protocolPath,
      recipient        : options.recipient,
      schema           : options.schema !== undefined ? normalizeSchemaUrl(options.schema) : undefined,
      parentId         : options.parentId,
      dataCid,
      dataSize,
      dateCreated      : options.dateCreated ?? currentTime,
      messageTimestamp : options.messageTimestamp ?? currentTime,
      published        : options.published,
      datePublished    : options.datePublished,
      dataFormat       : options.dataFormat
    };

    // generate `datePublished` if the message is to be published but `datePublished` is not given
    if (options.published === true &&
      options.datePublished === undefined) {
      descriptor.datePublished = currentTime;
    }

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    // `recordId` computation
    const recordId = options.recordId;

    // `contextId` computation
    const contextId = options.contextId;

    // `attestation` generation
    const descriptorCid = await Cid.computeCid(descriptor);
    const attestation = await RecordsWrite.createAttestation(descriptorCid, options.attestationSignatureInputs);

    // `encryption` generation
    const encryption = await RecordsWrite.createEncryptionProperty(descriptor, options.encryptionInput);

    const message: InternalRecordsWriteMessage = {
      recordId,
      descriptor
    };

    // assign optional properties only if they exist
    if (contextId !== undefined) { message.contextId = contextId; }
    if (attestation !== undefined) { message.attestation = attestation; }
    if (encryption !== undefined) { message.encryption = encryption; }

    // validateJsonSchema('RecordsWriteUnauthorized', message);

    const recordsWrite = new RecordsWrite(message);

    if (options.authorizationSignatureInput !== undefined) {
      await recordsWrite.sign(options.authorizationSignatureInput);
    }

    return recordsWrite;
  }

  /**
   * Convenience method that creates a message by:
   * 1. Copying over immutable properties from the given unsigned message
   * 2. Copying over mutable properties that are not overwritten from the given unsigned message
   * 3. Replace the mutable properties that are given new value
   * @param options.unsignedRecordsWriteMessage Unsigned message that the new RecordsWrite will be based from.
   * @param options.messageTimestamp The new date the record is modified. If not given, current time will be used .
   * @param options.data The new data or the record. If not given, data from given message will be used.
   * @param options.published The new published state. If not given, then will be set to `true` if {options.messageTimestamp} is given;
   * else the state from given message will be used.
   * @param options.publishedDate The new date the record is modified. If not given, then:
   * - will not be set if the record will be unpublished as the result of this RecordsWrite; else
   * - will be set to the same published date as the given message if it wss already published; else
   * - will be set to current time (because this is a toggle from unpublished to published)
   */
  public static async createFrom(options: CreateFromOptions): Promise<RecordsWrite> {
    const unsignedMessage = options.unsignedRecordsWriteMessage;
    const currentTime = getCurrentTimeInHighPrecision();

    // inherit published value from parent if neither published nor datePublished is specified
    const published = options.published ?? (options.datePublished ? true : unsignedMessage.descriptor.published);
    // use current time if published but no explicit time given
    let datePublished: string | undefined = undefined;
    // if given explicitly published dated
    if (options.datePublished) {
      datePublished = options.datePublished;
    } else {
      // if this RecordsWrite will publish the record
      if (published) {
        // the parent was already published, inherit the same published date
        if (unsignedMessage.descriptor.published) {
          datePublished = unsignedMessage.descriptor.datePublished;
        } else {
          // this is a toggle from unpublished to published, use current time
          datePublished = currentTime;
        }
      }
    }

    const createOptions: RecordsWriteOptions = {
      // immutable properties below, just inherit from the message given
      recipient                   : unsignedMessage.descriptor.recipient,
      recordId                    : unsignedMessage.recordId,
      dateCreated                 : unsignedMessage.descriptor.dateCreated,
      contextId                   : unsignedMessage.contextId,
      protocol                    : unsignedMessage.descriptor.protocol,
      protocolPath                : unsignedMessage.descriptor.protocolPath,
      parentId                    : unsignedMessage.descriptor.parentId,
      schema                      : unsignedMessage.descriptor.schema,
      dataFormat                  : unsignedMessage.descriptor.dataFormat,
      // mutable properties below
      messageTimestamp            : options.messageTimestamp ?? currentTime,
      published,
      datePublished,
      data                        : options.data,
      dataCid                     : options.data ? undefined : unsignedMessage.descriptor.dataCid, // if data not given, use base message dataCid
      dataSize                    : options.data ? undefined : unsignedMessage.descriptor.dataSize, // if data not given, use base message dataSize
      // finally still need input for signing
      authorizationSignatureInput : options.authorizationSignatureInput,
      attestationSignatureInputs  : options.attestationSignatureInputs
    };

    const recordsWrite = await RecordsWrite.create(createOptions);
    return recordsWrite;
  }

  /**
   * Called by `JSON.stringify(...)` automatically.
   */
  toJSON(): RecordsWriteMessage {
    return this.message;
  }

  /**
   * Encrypts the symmetric encryption key using the public keys given and attach the resulting `encryption` property to the RecordsWrite.
   */
  public async encryptSymmetricEncryptionKey(encryptionInput: EncryptionInput): Promise<void> {
    this._message.encryption = await RecordsWrite.createEncryptionProperty(this._message.descriptor, encryptionInput);

    // opportunity here to re-sign instead of remove
    delete this._message.authorization;
    this._authorizationPayload = undefined;
    this._author = undefined;
  }

  /**
   * Signs the RecordsWrite.
   */
  public async sign(signatureInput: SignatureInput): Promise<void> {
    const author = Jws.extractDid(signatureInput.protectedHeader.kid);

    const descriptor = this._message.descriptor;
    const descriptorCid = await Cid.computeCid(descriptor);

    // `recordId` computation if not given at construction time
    this._message.recordId = this._message.recordId ?? await RecordsWrite.getEntryId(author, descriptor);

    // `contextId` computation if not given at construction time and this is a protocol-space record
    if (this._message.contextId === undefined && this._message.descriptor.protocol !== undefined) {
      this._message.contextId = await RecordsWrite.getEntryId(author, descriptor);
    }

    // `authorization` generation
    const authorization = await RecordsWrite.createAuthorization(
      this._message.recordId,
      this._message.contextId,
      descriptorCid,
      this._message.attestation,
      this._message.encryption,
      signatureInput
    );

    this._message.authorization = authorization;

    // there is opportunity to optimize here as the payload is constructed within `createAuthorization(...)`
    this._authorizationPayload = Jws.decodePlainObjectPayload(authorization);
    this._author = author;
  }

  public async authorize(tenant: string, messageStore: MessageStore): Promise<void> {
    if (this.message.descriptor.protocol !== undefined) {
      // NOTE: `author` definitely exists because of the earlier `authenticate()` call
      await ProtocolAuthorization.authorize(tenant, this, this.author!, messageStore);
    } else {
      await authorize(tenant, this);
    }
  }

  /**
   * Validates the integrity of the RecordsWrite message assuming the message passed basic schema validation.
   * There is opportunity to integrate better with `validateSchema(...)`
   */
  private async validateIntegrity(): Promise<void> {
    // validateAuthorizationIntegrity() enforces the presence of authorization for RecordsWrite
    const authorizationPayload = this.authorizationPayload!;

    // make sure the `recordId` in message is the same as the `recordId` in `authorization`
    if (this.message.recordId !== authorizationPayload.recordId) {
      throw new Error(
        `recordId in message ${this.message.recordId} does not match recordId in authorization: ${authorizationPayload.recordId}`
      );
    }

    // if the new message is the initial write
    const isInitialWrite = await this.isInitialWrite();
    if (isInitialWrite) {
      // `messageTimestamp` and `dateCreated` equality check
      const dateRecordCreated = this.message.descriptor.dateCreated;
      const messageTimestamp = this.message.descriptor.messageTimestamp;
      if (messageTimestamp !== dateRecordCreated) {
        throw new Error(`messageTimestamp ${messageTimestamp} must match dateCreated ${dateRecordCreated} for the initial write`);
      }

      // if the message is also a protocol context root, the `contextId` must match the expected deterministic value
      if (this.message.descriptor.protocol !== undefined &&
        this.message.descriptor.parentId === undefined) {
        const expectedContextId = await this.getEntryId();

        if (this.message.contextId !== expectedContextId) {
          throw new Error(`contextId in message: ${this.message.contextId} does not match deterministic contextId: ${expectedContextId}`);
        }
      }
    }

    // if `contextId` is given in message, make sure the same `contextId` is in the `authorization`
    if (this.message.contextId !== authorizationPayload.contextId) {
      throw new Error(
        `contextId in message ${this.message.contextId} does not match contextId in authorization: ${authorizationPayload.contextId}`
      );
    }

    // if `attestation` is given in message, make sure the correct `attestationCid` is in the `authorization`
    if (authorizationPayload.attestationCid !== undefined) {
      const expectedAttestationCid = await Cid.computeCid(this.message.attestation);
      const actualAttestationCid = authorizationPayload.attestationCid;
      if (actualAttestationCid !== expectedAttestationCid) {
        throw new Error(
          `CID ${expectedAttestationCid} of attestation property in message does not match attestationCid in authorization: ${actualAttestationCid}`
        );
      }
    }

    // if `encryption` is given in message, make sure the correct `encryptionCid` is in the `authorization`
    if (authorizationPayload.encryptionCid !== undefined) {
      const expectedEncryptionCid = await Cid.computeCid(this.message.encryption);
      const actualEncryptionCid = authorizationPayload.encryptionCid;
      if (actualEncryptionCid !== expectedEncryptionCid) {
        throw new DwnError(
          DwnErrorCode.RecordsWriteValidateIntegrityEncryptionCidMismatch,
          `CID ${expectedEncryptionCid} of encryption property in message does not match encryptionCid in authorization: ${actualEncryptionCid}`
        );
      }
    }

    if (this.message.descriptor.protocol !== undefined) {
      validateProtocolUrlNormalized(this.message.descriptor.protocol);
    }
    if (this.message.descriptor.schema !== undefined) {
      validateSchemaUrlNormalized(this.message.descriptor.schema);
    }
  }

  /**
   * Validates the structural integrity of the `attestation` property.
   * NOTE: signature is not verified.
   */
  private static async validateAttestationIntegrity(message: RecordsWriteMessage): Promise<void> {
    if (message.attestation === undefined) {
      return;
    }

    // TODO: multi-attesters to be unblocked by #205 - Revisit database interfaces (https://github.com/TBD54566975/dwn-sdk-js/issues/205)
    if (message.attestation.signatures.length !== 1) {
      throw new Error(`Currently implementation only supports 1 attester, but got ${message.attestation.signatures.length}`);
    }

    const payloadJson = Jws.decodePlainObjectPayload(message.attestation);
    const { descriptorCid } = payloadJson;

    // `descriptorCid` validation - ensure that the provided descriptorCid matches the CID of the actual message
    const expectedDescriptorCid = await Cid.computeCid(message.descriptor);
    if (descriptorCid !== expectedDescriptorCid) {
      throw new Error(`descriptorCid ${descriptorCid} does not match expected descriptorCid ${expectedDescriptorCid}`);
    }

    // check to ensure that no other unexpected properties exist in payload.
    const propertyCount = Object.keys(payloadJson).length;
    if (propertyCount > 1) {
      throw new Error(`Only 'descriptorCid' is allowed in attestation payload, but got ${propertyCount} properties.`);
    }
  };

  /**
   * Computes the deterministic Entry ID of this message.
   */
  public async getEntryId(): Promise<string> {
    const entryId = await RecordsWrite.getEntryId(this.author, this.message.descriptor);
    return entryId;
  };

  /**
   * Computes the deterministic Entry ID of this message.
   */
  public static async getEntryId(author: string | undefined, descriptor: RecordsWriteDescriptor): Promise<string> {
    // TODO: this paves the way to allow unsigned RecordsWrite as suggested in #206 (https://github.com/TBD54566975/dwn-sdk-js/issues/206)
    if (author === undefined) {
      throw new DwnError(DwnErrorCode.RecordsWriteGetEntryIdUndefinedAuthor, 'Property `author` is needed to compute entry ID.');
    }

    const entryIdInput = { ...descriptor };
    (entryIdInput as any).author = author;

    const cid = await Cid.computeCid(entryIdInput);
    return cid;
  };

  /**
   * Checks if the given message is the initial entry of a record.
   */
  public async isInitialWrite(): Promise<boolean> {
    const entryId = await this.getEntryId();
    return (entryId === this.message.recordId);
  }

  /**
   * Checks if the given message is the initial entry of a record.
   */
  public static async isInitialWrite(message: GenericMessage): Promise<boolean> {
    // can't be the initial write if the message is not a Records Write
    if (message.descriptor.interface !== DwnInterfaceName.Records ||
        message.descriptor.method !== DwnMethodName.Write) {
      return false;
    }

    const recordsWriteMessage = message as RecordsWriteMessage;
    const author = Message.getAuthor(message);
    const entryId = await RecordsWrite.getEntryId(author, recordsWriteMessage.descriptor);
    return (entryId === recordsWriteMessage.recordId);
  }

  /**
   * Creates the `encryption` property if encryption input is given. Else `undefined` is returned.
   */
  private static async createEncryptionProperty(
    descriptor: RecordsWriteDescriptor,
    encryptionInput: EncryptionInput | undefined
  ): Promise<EncryptionProperty | undefined> {
    if (encryptionInput === undefined) {
      return undefined;
    }

    // encrypt the data encryption key once per encryption input
    const keyEncryption: EncryptedKey[] = [];
    for (const keyEncryptionInput of encryptionInput.keyEncryptionInputs) {

      if (keyEncryptionInput.derivationScheme ===  KeyDerivationScheme.ProtocolPath && descriptor.protocol === undefined) {
        throw new DwnError(
          DwnErrorCode.RecordsWriteMissingProtocol,
          '`protocols` encryption scheme cannot be applied to record without the `protocol` property.'
        );
      }

      if (keyEncryptionInput.derivationScheme ===  KeyDerivationScheme.Schemas && descriptor.schema === undefined) {
        throw new DwnError(
          DwnErrorCode.RecordsWriteMissingSchema,
          '`schemas` encryption scheme cannot be applied to record without the `schema` property.'
        );
      }

      // NOTE: right now only `ECIES-ES256K` algorithm is supported for asymmetric encryption,
      // so we will assume that's the algorithm without additional switch/if statements
      const publicKeyBytes = Secp256k1.publicJwkToBytes(keyEncryptionInput.publicKey);
      const keyEncryptionOutput = await Encryption.eciesSecp256k1Encrypt(publicKeyBytes, encryptionInput.key);

      const encryptedKey = Encoder.bytesToBase64Url(keyEncryptionOutput.ciphertext);
      const ephemeralPublicKey = await Secp256k1.publicKeyToJwk(keyEncryptionOutput.ephemeralPublicKey);
      const keyEncryptionInitializationVector = Encoder.bytesToBase64Url(keyEncryptionOutput.initializationVector);
      const messageAuthenticationCode = Encoder.bytesToBase64Url(keyEncryptionOutput.messageAuthenticationCode);
      const encryptedKeyData: EncryptedKey = {
        rootKeyId            : keyEncryptionInput.publicKeyId,
        algorithm            : keyEncryptionInput.algorithm ?? EncryptionAlgorithm.EciesSecp256k1,
        derivationScheme     : keyEncryptionInput.derivationScheme,
        ephemeralPublicKey,
        initializationVector : keyEncryptionInitializationVector,
        messageAuthenticationCode,
        encryptedKey
      };

      // we need to attach the actual public key if derivation scheme is protocol-context,
      // so that the responder to this message is able to encrypt the message/symmetric key using the same protocol-context derived public key,
      // without needing the knowledge of the corresponding private key
      if (keyEncryptionInput.derivationScheme ===  KeyDerivationScheme.ProtocolContext) {
        encryptedKeyData.derivedPublicKey = keyEncryptionInput.publicKey;
      }

      keyEncryption.push(encryptedKeyData);
    }

    const encryption: EncryptionProperty = {
      algorithm            : encryptionInput.algorithm ?? EncryptionAlgorithm.Aes256Ctr,
      initializationVector : Encoder.bytesToBase64Url(encryptionInput.initializationVector),
      keyEncryption
    };

    return encryption;
  }

  /**
   * Creates the `attestation` property of a RecordsWrite message if given signature inputs; returns `undefined` otherwise.
   */
  public static async createAttestation(descriptorCid: string, signatureInputs?: SignatureInput[]): Promise<GeneralJws | undefined> {
    if (signatureInputs === undefined || signatureInputs.length === 0) {
      return undefined;
    }

    const attestationPayload: RecordsWriteAttestationPayload = { descriptorCid };
    const attestationPayloadBytes = Encoder.objectToBytes(attestationPayload);

    const signer = await GeneralJwsSigner.create(attestationPayloadBytes, signatureInputs);
    return signer.getJws();
  }

  /**
   * Creates the `authorization` property of a RecordsWrite message.
   */
  public static async createAuthorization(
    recordId: string,
    contextId: string | undefined,
    descriptorCid: string,
    attestation: GeneralJws | undefined,
    encryption: EncryptionProperty | undefined,
    signatureInput: SignatureInput
  ): Promise<GeneralJws> {
    const authorizationPayload: RecordsWriteAuthorizationPayload = {
      recordId,
      descriptorCid
    };

    const attestationCid = attestation ? await Cid.computeCid(attestation) : undefined;
    const encryptionCid = encryption ? await Cid.computeCid(encryption) : undefined;

    if (contextId !== undefined) { authorizationPayload.contextId = contextId; } // assign `contextId` only if it is defined
    if (attestationCid !== undefined) { authorizationPayload.attestationCid = attestationCid; } // assign `attestationCid` only if it is defined
    if (encryptionCid !== undefined) { authorizationPayload.encryptionCid = encryptionCid; } // assign `encryptionCid` only if it is defined

    const authorizationPayloadBytes = Encoder.objectToBytes(authorizationPayload);

    const signer = await GeneralJwsSigner.create(authorizationPayloadBytes, [signatureInput]);
    return signer.getJws();
  }

  /**
   * Gets the initial write from the given list or record write.
   */
  public static async getInitialWrite(messages: GenericMessage[]): Promise<RecordsWriteMessage>{
    for (const message of messages) {
      if (await RecordsWrite.isInitialWrite(message)) {
        return message as RecordsWriteMessage;
      }
    }

    throw new Error(`initial write is not found`);
  }

  /**
   * Verifies that immutable properties of the two given messages are identical.
   * @throws {Error} if immutable properties between two RecordsWrite message
   */
  public static verifyEqualityOfImmutableProperties(existingWriteMessage: RecordsWriteMessage, newMessage: RecordsWriteMessage): boolean {
    const mutableDescriptorProperties = ['dataCid', 'dataSize', 'datePublished', 'published', 'messageTimestamp'];

    // get distinct property names that exist in either the existing message given or new message
    let descriptorPropertyNames: string[] = [];
    descriptorPropertyNames.push(...Object.keys(existingWriteMessage.descriptor));
    descriptorPropertyNames.push(...Object.keys(newMessage.descriptor));
    descriptorPropertyNames = [...new Set(descriptorPropertyNames)]; // step to remove duplicates

    // ensure all immutable properties are not modified
    for (const descriptorPropertyName of descriptorPropertyNames) {
      // if property is supposed to be immutable
      if (mutableDescriptorProperties.indexOf(descriptorPropertyName) === -1) {
        const valueInExistingWrite = (existingWriteMessage.descriptor as any)[descriptorPropertyName];
        const valueInNewMessage = (newMessage.descriptor as any)[descriptorPropertyName];
        if (valueInNewMessage !== valueInExistingWrite) {
          throw new Error(`${descriptorPropertyName} is an immutable property: cannot change '${valueInExistingWrite}' to '${valueInNewMessage}'`);
        }
      }
    }

    return true;
  }

  /**
   * Gets the DID of the author of the given message.
   */
  public static getAttesters(message: InternalRecordsWriteMessage): string[] {
    const attestationSignatures = message.attestation?.signatures ?? [];
    const attesters = attestationSignatures.map((signature) => Jws.getSignerDid(signature));
    return attesters;
  }
}
