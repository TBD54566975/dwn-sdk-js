import type { DelegatedGrantMessage } from '../types/permissions-types.js';
import type { GeneralJws } from '../types/jws-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { PublicJwk } from '../types/jose-types.js';
import type { Signer } from '../types/signer.js';
import type {
  EncryptedKey,
  EncryptionProperty,
  InternalRecordsWriteMessage,
  RecordsWriteAttestationPayload,
  RecordsWriteDescriptor,
  RecordsWriteMessage,
  RecordsWriteSignaturePayload
} from '../types/records-types.js';
import type { GenericMessage, GenericSignaturePayload } from '../types/message-types.js';

import { Cid } from '../utils/cid.js';
import { Encoder } from '../utils/encoder.js';
import { Encryption } from '../utils/encryption.js';
import { EncryptionAlgorithm } from '../utils/encryption.js';
import { GeneralJwsBuilder } from '../jose/jws/general/builder.js';
import { Jws } from '../utils/jws.js';
import { KeyDerivationScheme } from '../utils/hd-key.js';
import { Message } from '../core/message.js';
import { ProtocolAuthorization } from '../core/protocol-authorization.js';
import { RecordsGrantAuthorization } from '../core/records-grant-authorization.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { Secp256k1 } from '../utils/secp256k1.js';
import { validateMessageSignatureIntegrity } from '../core/auth.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../core/message.js';
import { getCurrentTimeInHighPrecision, validateTimestamp } from '../utils/time.js';
import { normalizeProtocolUrl, normalizeSchemaUrl, validateProtocolUrlNormalized, validateSchemaUrlNormalized } from '../utils/url.js';

export type RecordsWriteOptions = {
  recipient?: string;
  protocol?: string;
  protocolPath?: string;
  protocolRole?: string;
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

  /**
   * Signer of the message.
   */
  signer?: Signer;

  /**
   * The delegated grant to sign on behalf of the logical author, which is the grantor (`grantedBy`) of the delegated grant.
   */
  delegatedGrant?: DelegatedGrantMessage;

  attestationSigners?: Signer[];
  encryptionInput?: EncryptionInput;
  permissionsGrantId?: string;
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
  recordsWriteMessage: RecordsWriteMessage,
  data?: Uint8Array;
  published?: boolean;
  messageTimestamp?: string;
  datePublished?: string;

  /**
   * Signer of the message.
   */
  signer?: Signer;

  /**
   * The delegated grant to sign on behalf of the logical author, which is the grantor (`grantedBy`) of the delegated grant.
   */
  delegatedGrant?: DelegatedGrantMessage;

  attestationSigners?: Signer[];
  encryptionInput?: EncryptionInput;
  protocolRole?: string;
};

export class RecordsWrite {
  private _message: InternalRecordsWriteMessage;
  /**
   * Valid JSON message representing this RecordsWrite.
   * @throws `DwnErrorCode.RecordsWriteMissingAuthorizationSigner` if the message is not signed yet.
   */
  public get message(): RecordsWriteMessage {
    if (this._message.authorization === undefined) {
      throw new DwnError(
        DwnErrorCode.RecordsWriteMissingAuthorizationSigner,
        'This RecordsWrite is not yet signed, JSON message cannot be generated from an incomplete state.'
      );
    }

    return this._message as RecordsWriteMessage;
  }

  private _author: string | undefined;
  /**
   * DID of the logical author of this message.
   * NOTE: we say "logical" author because a message can be signed by a delegate of the actual author,
   * in which case the author DID would not be the same as the signer/delegate DID,
   * but be the DID of the grantor (`grantedBy`) of the delegated grant presented.
   */
  public get author(): string | undefined {
    return this._author;
  }

  private _signerSignaturePayload: RecordsWriteSignaturePayload | undefined;
  /**
   * Decoded signer signature payload.
   */
  public get signerSignaturePayload(): RecordsWriteSignaturePayload | undefined {
    return this._signerSignaturePayload;
  }

  private _owner: string | undefined;
  /**
   * DID of owner of this message.
   */
  public get owner(): string | undefined {
    return this._owner;
  }

  private _ownerSignaturePayload: GenericSignaturePayload | undefined;
  /**
   * Decoded owner signature payload.
   */
  public get ownerSignaturePayload(): GenericSignaturePayload | undefined {
    return this._ownerSignaturePayload;
  }

  readonly attesters: string[];

  private constructor(message: InternalRecordsWriteMessage) {
    this._message = message;

    if (message.authorization !== undefined) {
      // if the message authorization contains author delegated grant, the author would be the grantor of the grant
      // else the author would be the signer of the message
      if (message.authorization.authorDelegatedGrant !== undefined) {
        this._author = Message.getSigner(message.authorization.authorDelegatedGrant);
      } else {
        this._author = Message.getSigner(message as GenericMessage);
      }

      this._signerSignaturePayload = Jws.decodePlainObjectPayload(message.authorization.authorSignature);

      if (message.authorization.ownerSignature !== undefined) {
        this._owner = Jws.getSignerDid(message.authorization.ownerSignature.signatures[0]);
        this._ownerSignaturePayload = Jws.decodePlainObjectPayload(message.authorization.ownerSignature);
      }
    }

    this.attesters = RecordsWrite.getAttesters(message);

    // consider converting isInitialWrite() & getEntryId() into properties for performance and convenience
  }

  public static async parse(message: RecordsWriteMessage): Promise<RecordsWrite> {
    // asynchronous checks that are required by the constructor to initialize members properly

    await validateMessageSignatureIntegrity(message.authorization.authorSignature, message.descriptor, 'RecordsWriteSignaturePayload');

    if (message.authorization.ownerSignature !== undefined) {
      await validateMessageSignatureIntegrity(message.authorization.ownerSignature, message.descriptor);
    }

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

    if (options.signer === undefined && options.delegatedGrant !== undefined) {
      throw new DwnError(DwnErrorCode.RecordsWriteCreateMissingSigner, '`signer` must be given when `delegatedGrant` is given');
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
    const attestation = await RecordsWrite.createAttestation(descriptorCid, options.attestationSigners);

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

    const recordsWrite = new RecordsWrite(message);

    if (options.signer !== undefined) {
      await recordsWrite.sign({
        signer             : options.signer,
        delegatedGrant     : options.delegatedGrant,
        permissionsGrantId : options.permissionsGrantId,
        protocolRole       : options.protocolRole
      });
    }

    return recordsWrite;
  }

  /**
   * Convenience method that creates a message by:
   * 1. Copying over immutable properties from the given source message
   * 2. Copying over mutable properties that are not overwritten from the given source message
   * 3. Replace the mutable properties that are given new value
   * @param options.recordsWriteMessage Message that the new RecordsWrite will be based from.
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
    const sourceMessage = options.recordsWriteMessage;
    const currentTime = getCurrentTimeInHighPrecision();

    // inherit published value from parent if neither published nor datePublished is specified
    const published = options.published ?? (options.datePublished ? true : sourceMessage.descriptor.published);
    // use current time if published but no explicit time given
    let datePublished: string | undefined = undefined;
    // if given explicitly published dated
    if (options.datePublished) {
      datePublished = options.datePublished;
    } else {
      // if this RecordsWrite will publish the record
      if (published) {
        // the parent was already published, inherit the same published date
        if (sourceMessage.descriptor.published) {
          datePublished = sourceMessage.descriptor.datePublished;
        } else {
          // this is a toggle from unpublished to published, use current time
          datePublished = currentTime;
        }
      }
    }

    const createOptions: RecordsWriteOptions = {
      // immutable properties below, just inherit from the message given
      recipient          : sourceMessage.descriptor.recipient,
      recordId           : sourceMessage.recordId,
      dateCreated        : sourceMessage.descriptor.dateCreated,
      contextId          : sourceMessage.contextId,
      protocol           : sourceMessage.descriptor.protocol,
      protocolPath       : sourceMessage.descriptor.protocolPath,
      parentId           : sourceMessage.descriptor.parentId,
      schema             : sourceMessage.descriptor.schema,
      dataFormat         : sourceMessage.descriptor.dataFormat,
      // mutable properties below
      messageTimestamp   : options.messageTimestamp ?? currentTime,
      published,
      datePublished,
      data               : options.data,
      dataCid            : options.data ? undefined : sourceMessage.descriptor.dataCid, // if data not given, use base message dataCid
      dataSize           : options.data ? undefined : sourceMessage.descriptor.dataSize, // if data not given, use base message dataSize
      protocolRole       : options.protocolRole,
      delegatedGrant     : options.delegatedGrant,
      // finally still need signers
      signer             : options.signer,
      attestationSigners : options.attestationSigners
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
    this._signerSignaturePayload = undefined;
    this._author = undefined;
  }

  /**
   * Signs the RecordsWrite, commonly as author, but can also be a delegate.
   */
  public async sign(options: {
    signer: Signer,
    delegatedGrant?: DelegatedGrantMessage,
    permissionsGrantId?: string,
    protocolRole?: string
  }): Promise<void> {
    const { signer, delegatedGrant, permissionsGrantId, protocolRole } = options;

    // compute delegated grant ID and author if delegated grant is given
    let delegatedGrantId;
    let authorDid;
    if (delegatedGrant !== undefined) {
      delegatedGrantId = await Message.getCid(delegatedGrant);
      authorDid = Jws.getSignerDid(delegatedGrant.authorization.authorSignature.signatures[0]);
    } else {
      authorDid = Jws.extractDid(signer.keyId);
    }

    const descriptor = this._message.descriptor;
    const descriptorCid = await Cid.computeCid(descriptor);

    // `recordId` computation if not given at construction time
    this._message.recordId = this._message.recordId ?? await RecordsWrite.getEntryId(authorDid, descriptor);

    // `contextId` computation if not given at construction time and this is a protocol-space record
    if (this._message.contextId === undefined && this._message.descriptor.protocol !== undefined) {
      this._message.contextId = await RecordsWrite.getEntryId(authorDid, descriptor);
    }

    // `signerSignature` generation
    const additionalPropertiesToSign = {
      delegatedGrantId,
      permissionsGrantId,
      protocolRole
    };
    const signerSignature = await RecordsWrite.createSignerSignature(
      this._message.recordId,
      this._message.contextId,
      descriptorCid,
      this._message.attestation,
      this._message.encryption,
      signer,
      additionalPropertiesToSign
    );

    this._message.authorization = { authorSignature: signerSignature };

    if (delegatedGrant !== undefined) {
      this._message.authorization.authorDelegatedGrant = delegatedGrant;
    }

    // there is opportunity to optimize here as the payload is constructed within `createAuthorization(...)`
    this._signerSignaturePayload = Jws.decodePlainObjectPayload(signerSignature);
    this._author = authorDid;
  }

  /**
   * Signs the `RecordsWrite` as the DWN owner.
   * This is used when the DWN owner wants to retain a copy of a message that the owner did not author.
   * NOTE: requires the `RecordsWrite` to already have the author's signature already.
   */
  public async signAsOwner(signer: Signer, permissionsGrantId?: string): Promise<void> {
    if (this._author === undefined) {
      throw new DwnError(
        DwnErrorCode.RecordsWriteSignAsOwnerUnknownAuthor,
        'Unable to sign as owner if without signer signature because owner needs to sign over `recordId` which depends on author DID.');
    }

    const descriptor = this._message.descriptor;
    const ownerSignature = await Message.createSignature(descriptor, signer, { permissionsGrantId });

    this._message.authorization!.ownerSignature = ownerSignature;

    this._ownerSignaturePayload = Jws.decodePlainObjectPayload(ownerSignature);
    this._owner = Jws.extractDid(signer.keyId);
    ;
  }

  public async authorize(tenant: string, messageStore: MessageStore): Promise<void> {
    // if owner DID is specified, it must be the same as the tenant DID
    if (this.owner !== undefined && this.owner !== tenant) {
      throw new DwnError(
        DwnErrorCode.RecordsWriteOwnerAndTenantMismatch,
        `Owner ${this.owner } must be the same as tenant ${tenant} when specified.`
      );
    }

    if (this.owner !== undefined) {
      // if incoming message is a write retained by this tenant, we by-design always allow
      // NOTE: the "owner === tenant" check is already done earlier in this method
      return;
    } else if (this.author === tenant) {
      // if author is the same as the target tenant, we can directly grant access
      return;
    } else if (this.author !== undefined && this.signerSignaturePayload!.permissionsGrantId !== undefined) {
      await RecordsGrantAuthorization.authorizeWrite(tenant, this, this.author, messageStore);
    } else if (this.message.descriptor.protocol !== undefined) {
      await ProtocolAuthorization.authorizeWrite(tenant, this, messageStore);
    } else {
      throw new Error('message failed authorization');
    }
  }

  /**
   * Validates the integrity of the RecordsWrite message assuming the message passed basic schema validation.
   * There is opportunity to integrate better with `validateSchema(...)`
   */
  private async validateIntegrity(): Promise<void> {
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

    // NOTE: validateMessageSignatureIntegrity() call earlier enforces the presence of `authorization` and thus `authorSignature` in RecordsWrite
    const signerSignaturePayload = this.signerSignaturePayload!;

    // make sure the `recordId` in message is the same as the `recordId` in signer signature payload
    if (this.message.recordId !== signerSignaturePayload.recordId) {
      throw new Error(
        `recordId in message ${this.message.recordId} does not match recordId in authorization: ${signerSignaturePayload.recordId}`
      );
    }

    // if `contextId` is given in message, make sure the same `contextId` is in the signer signature payload
    if (this.message.contextId !== signerSignaturePayload.contextId) {
      throw new Error(
        `contextId in message ${this.message.contextId} does not match contextId in authorization: ${signerSignaturePayload.contextId}`
      );
    }

    // `deletedGrantId` in the signer signature payload and `authorDelegatedGrant` in `authorization` must both exist or be both undefined
    const delegatedGrantIdDefined = signerSignaturePayload.delegatedGrantId !== undefined;
    const authorDelegatedGrantDefined = this.message.authorization!.authorDelegatedGrant !== undefined;
    if (delegatedGrantIdDefined !== authorDelegatedGrantDefined) {
      throw new DwnError(
        DwnErrorCode.RecordsWriteValidateIntegrityDelegatedGrantAndIdExistenceMismatch,
        `delegatedGrantId and authorDelegatedGrant must both exist or be undefine. \
         delegatedGrantId defined: ${delegatedGrantIdDefined}, authorDelegatedGrant defined: ${authorDelegatedGrantDefined}`
      );
    }

    // when delegated grant exists, the grantee (grantedTo) must be the same as the signer of the message
    if (authorDelegatedGrantDefined) {
      const grantedTo = this.message.authorization!.authorDelegatedGrant!.descriptor.grantedTo;
      const signer = Message.getSigner(this.message);
      if (grantedTo !== signer) {
        throw new DwnError(
          DwnErrorCode.RecordsWriteValidateIntegrityGrantedToAndSignerMismatch,
          `grantedTo ${grantedTo} must be the same as the signer ${signer} of the message`
        );
      }
    }

    // if `attestation` is given in message, make sure the correct `attestationCid` is in the signer signature payload
    if (signerSignaturePayload.attestationCid !== undefined) {
      const expectedAttestationCid = await Cid.computeCid(this.message.attestation);
      const actualAttestationCid = signerSignaturePayload.attestationCid;
      if (actualAttestationCid !== expectedAttestationCid) {
        throw new Error(
          `CID ${expectedAttestationCid} of attestation property in message does not match attestationCid in authorization: ${actualAttestationCid}`
        );
      }
    }

    // if `encryption` is given in message, make sure the correct `encryptionCid` is in the signer signature payload
    if (signerSignaturePayload.encryptionCid !== undefined) {
      const expectedEncryptionCid = await Cid.computeCid(this.message.encryption);
      const actualEncryptionCid = signerSignaturePayload.encryptionCid;
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

    validateTimestamp(this.message.descriptor.messageTimestamp);
    validateTimestamp(this.message.descriptor.dateCreated);
    if (this.message.descriptor.datePublished){
      validateTimestamp(this.message.descriptor.datePublished);
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
   * Checks if the author of the RecordsWrite is the same as the author of the initial RecordsWrite for the record.
   * Returns true if `this` is the initial RecordsWrite.
   */
  public async isAuthoredByInitialRecordAuthor(tenant: string, messageStore: MessageStore): Promise<boolean> {
    // fetch the initialWrite
    const query = {
      entryId: this.message.recordId
    };
    const { messages: result } = await messageStore.query(tenant, [ query ]);

    const initialRecordsWrite = await RecordsWrite.parse(result[0] as RecordsWriteMessage);
    return initialRecordsWrite.author === this.author;
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
    const author = RecordsWrite.getAuthor(recordsWriteMessage);
    const entryId = await RecordsWrite.getEntryId(author, recordsWriteMessage.descriptor);
    return (entryId === recordsWriteMessage.recordId);
  }

  /**
   * Gets the DID of the author of the given message.
   */
  public static getAuthor(message: RecordsWriteMessage): string | undefined {
    let author;

    if (message.authorization.authorDelegatedGrant !== undefined) {
      author = Message.getSigner(message.authorization.authorDelegatedGrant);
    } else {
      author = Message.getSigner(message);
    }

    return author;
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
  public static async createAttestation(descriptorCid: string, signers?: Signer[]): Promise<GeneralJws | undefined> {
    if (signers === undefined || signers.length === 0) {
      return undefined;
    }

    const attestationPayload: RecordsWriteAttestationPayload = { descriptorCid };
    const attestationPayloadBytes = Encoder.objectToBytes(attestationPayload);

    const builder = await GeneralJwsBuilder.create(attestationPayloadBytes, signers);
    return builder.getJws();
  }

  /**
   * Creates the `signerSignature` property in the `authorization` of a `RecordsWrite` message.
   */
  public static async createSignerSignature(
    recordId: string,
    contextId: string | undefined,
    descriptorCid: string,
    attestation: GeneralJws | undefined,
    encryption: EncryptionProperty | undefined,
    signer: Signer,
    additionalProperties?: { delegatedGrantId?: string, permissionsGrantId?: string, protocolRole?: string },
  ): Promise<GeneralJws> {
    const attestationCid = attestation ? await Cid.computeCid(attestation) : undefined;
    const encryptionCid = encryption ? await Cid.computeCid(encryption) : undefined;

    const signaturePayload: RecordsWriteSignaturePayload = {
      recordId,
      descriptorCid,
      contextId,
      attestationCid,
      encryptionCid,
      delegatedGrantId   : additionalProperties?.delegatedGrantId,
      permissionsGrantId : additionalProperties?.permissionsGrantId,
      protocolRole       : additionalProperties?.protocolRole
    };
    removeUndefinedProperties(signaturePayload);

    const signaturePayloadBytes = Encoder.objectToBytes(signaturePayload);

    const builder = await GeneralJwsBuilder.create(signaturePayloadBytes, [signer]);
    const signature = builder.getJws();

    return signature;
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
