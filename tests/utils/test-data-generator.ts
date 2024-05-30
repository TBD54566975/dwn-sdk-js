import type { DerivedPrivateJwk } from '../../src/utils/hd-key.js';
import type { DidResolutionResult } from '@web5/dids';
import type { EventsQueryOptions } from '../../src/interfaces/events-query.js';
import type { EventsSubscribeOptions } from '../../src/interfaces/events-subscribe.js';
import type { GeneralJws } from '../../src/types/jws-types.js';
import type { MessagesGetMessage } from '../../src/types/messages-types.js';
import type { MessagesGetOptions } from '../../src/interfaces/messages-get.js';
import type { PaginationCursor } from '../../src/types/query-types.js';
import type { PermissionGrantCreateOptions } from '../../src/protocols/permissions.js';
import type { ProtocolsConfigureOptions } from '../../src/interfaces/protocols-configure.js';
import type { ProtocolsQueryOptions } from '../../src/interfaces/protocols-query.js';
import type { Readable } from 'readable-stream';
import type { RecordsQueryOptions } from '../../src/interfaces/records-query.js';
import type { RecordsSubscribeOptions } from '../../src/interfaces/records-subscribe.js';
import type { Signer } from '../../src/types/signer.js';
import type { AuthorizationModel, Pagination } from '../../src/types/message-types.js';
import type { CreateFromOptions, EncryptionInput, KeyEncryptionInput, RecordsWriteOptions } from '../../src/interfaces/records-write.js';
import type { DataEncodedRecordsWriteMessage, DateSort, RecordsDeleteMessage, RecordsFilter, RecordsQueryMessage, RecordsWriteTags } from '../../src/types/records-types.js';
import type { EventsFilter, EventsQueryMessage, EventsSubscribeMessage } from '../../src/types/events-types.js';
import type { PermissionConditions, PermissionScope } from '../../src/types/permission-types.js';
import type { PrivateJwk, PublicJwk } from '../../src/types/jose-types.js';
import type { ProtocolDefinition, ProtocolsConfigureMessage, ProtocolsQueryMessage } from '../../src/types/protocols-types.js';
import type { RecordsSubscribeMessage, RecordsWriteMessage } from '../../src/types/records-types.js';

import * as cbor from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';
import { DataStream } from '../../src/utils/data-stream.js';
import { DidKey } from '@web5/dids';
import { ed25519 } from '../../src/jose/algorithms/signing/ed25519.js';
import { Encoder } from '../../src/utils/encoder.js';
import { Encryption } from '../../src/utils/encryption.js';
import { EventsQuery } from '../../src/interfaces/events-query.js';
import { EventsSubscribe } from '../../src/interfaces/events-subscribe.js';
import { Jws } from '../../src/utils/jws.js';
import { MessagesGet } from '../../src/interfaces/messages-get.js';
import { PermissionsProtocol } from '../../src/protocols/permissions.js';
import { PrivateKeySigner } from '../../src/utils/private-key-signer.js';
import { ProtocolsConfigure } from '../../src/interfaces/protocols-configure.js';
import { ProtocolsQuery } from '../../src/interfaces/protocols-query.js';
import { Records } from '../../src/utils/records.js';
import { RecordsDelete } from '../../src/interfaces/records-delete.js';
import { RecordsQuery } from '../../src/interfaces/records-query.js';
import { RecordsSubscribe } from '../../src/interfaces/records-subscribe.js';
import { RecordsWrite } from '../../src/interfaces/records-write.js';
import { removeUndefinedProperties } from '../../src/utils/object.js';
import { Secp256k1 } from '../../src/utils/secp256k1.js';
import { sha256 } from 'multiformats/hashes/sha2';
import { Time } from '../../src/utils/time.js';
import { DwnInterfaceName, DwnMethodName } from '../../src/enums/dwn-interface-method.js';
import { HdKey, KeyDerivationScheme } from '../../src/utils/hd-key.js';

/**
 * A logical grouping of user data used to generate test messages.
 */
export type Persona = {
  did: string;
  keyId: string;
  keyPair: { publicJwk: PublicJwk, privateJwk: PrivateJwk };
  signer: Signer;
};

export type GenerateProtocolsConfigureInput = {
  /**
   * Denotes if the Protocol Definition can be returned by unauthenticated `ProtocolsQuery`.
   * Only takes effect if `protocolDefinition` is not explicitly set. Defaults to false if not specified.
   */
  published?: boolean;

  /**
   * Author who will be signing the protocol config created.
   */
  author?: Persona;
  messageTimestamp?: string;
  protocolDefinition?: ProtocolDefinition;
  permissionGrantId?: string;
};

export type GenerateProtocolsConfigureOutput = {
  author: Persona;
  message: ProtocolsConfigureMessage;
  protocolsConfigure: ProtocolsConfigure;
};

export type GenerateProtocolsQueryInput = {
  author?: Persona;
  messageTimestamp?: string;
  permissionGrantId?: string;
  filter?: {
    protocol: string;
  }
};

export type GenerateProtocolsQueryOutput = {
  author: Persona;
  message: ProtocolsQueryMessage;
  protocolsQuery: ProtocolsQuery;
};

export type GenerateGrantCreateInput = {
  author?: Persona;
  grantedTo?: Persona;
  dateGranted?: string;
  dateExpires?: string;
  requestId?: string;
  description?: string;
  delegated?: boolean;
  scope?: PermissionScope;
  conditions?: PermissionConditions;
};

export type GenerateGrantCreateOutput = {
  message: RecordsWriteMessage;
  dataBytes: Uint8Array;
  dataStream: Readable;
  recordsWrite: RecordsWrite;
  dataEncodedMessage: DataEncodedRecordsWriteMessage;
};

export type GenerateRecordsWriteInput = {
  // Will refactor only when the PR is reviewed approved to avoid polluting the PR.
  author?: Persona;
  attesters?: Persona[];
  recipient?: string;
  protocol?: string;
  protocolPath?: string;
  protocolRole?: string;
  schema?: string;
  tags?: RecordsWriteTags;
  recordId?: string;
  parentContextId?: string;
  published?: boolean;
  data?: Uint8Array;
  dataCid?: string;
  dataSize?: number;
  dataFormat?: string;
  dateCreated?: string;
  messageTimestamp?: string;
  datePublished?: string;
  encryptionInput?: EncryptionInput;
  permissionGrantId?: string;
};

export type GenerateFromRecordsWriteInput = {
  author: Persona,
  existingWrite: RecordsWrite,
  data?: Uint8Array;
  published?: boolean;
  tags?: RecordsWriteTags;
  messageTimestamp?: string;
  datePublished?: string;
  protocolRole?: string;
};

export type GenerateFromRecordsWriteOut = {
  message: RecordsWriteMessage;
  dataBytes: Uint8Array;
  dataStream: Readable;
  recordsWrite: RecordsWrite;
};

export type GenerateRecordsWriteOutput = {
  author: Persona;
  message: RecordsWriteMessage;
  dataCid?: string;
  dataSize?: number;
  dataBytes?: Uint8Array;
  dataStream?: Readable;
  recordsWrite: RecordsWrite;
};

export type GenerateRecordsQueryInput = {
  /**
   * Treated as `false` if not given.
   */
  anonymous?: boolean;
  author?: Persona;
  messageTimestamp?: string;
  filter?: RecordsFilter;
  dateSort?: DateSort;
  pagination?: Pagination;
  protocolRole?: string;
};

export type GenerateRecordsQueryOutput = {
  author: Persona | undefined;
  message: RecordsQueryMessage;
};

export type GenerateRecordsSubscribeInput = {
    /**
     * Treated as `false` if not given.
     */
    anonymous?: boolean;
    author?: Persona;
    messageTimestamp?: string;
    filter?: RecordsFilter;
    protocolRole?: string;
};

export type GenerateRecordsSubscribeOutput = {
  author: Persona | undefined;
  message: RecordsSubscribeMessage;
};

export type GenerateRecordsDeleteInput = {
  author?: Persona;
  recordId?: string;
  protocolRole?: string;
};

export type GenerateRecordsDeleteOutput = {
  author: Persona;
  recordsDelete: RecordsDelete;
  message: RecordsDeleteMessage;
};

export type GenerateEventsQueryInput = {
  author?: Persona;
  filters?: EventsFilter[];
  cursor?: PaginationCursor;
  permissionGrantId?: string;
};

export type GenerateEventsQueryOutput = {
  author: Persona;
  eventsQuery: EventsQuery;
  message: EventsQueryMessage;
};

export type GenerateEventsSubscribeInput = {
  author: Persona;
  filters?: EventsFilter[];
  messageTimestamp?: string;
  permissionGrantId?: string;
};

export type GenerateEventsSubscribeOutput = {
  author: Persona;
  eventsSubscribe: EventsSubscribe;
  message: EventsSubscribeMessage;
};

export type GenerateMessagesGetInput = {
  author?: Persona;
  messageCid: string;
};

export type GenerateMessagesGetOutput = {
  author: Persona;
  message: MessagesGetMessage;
  messagesGet: MessagesGet;
};

/**
 * Utility class for generating data for testing.
 */
export class TestDataGenerator {
  /**
   * Generates a persona.
   */
  public static async generatePersona(input?: Partial<Persona>): Promise<Persona> {
    // generate DID if not given
    let did = input?.did;
    if (!did) {
      const didSuffix = TestDataGenerator.randomString(32);
      did = `did:example:${didSuffix}`;
    }

    // generate persona key ID if not given
    const keyIdSuffix = TestDataGenerator.randomString(10);
    const keyId = input?.keyId ?? `${did}#${keyIdSuffix}`;

    // generate persona key pair if not given
    const keyPair = input?.keyPair ?? await Secp256k1.generateKeyPair();

    const persona: Persona = {
      did,
      keyId,
      keyPair,
      signer: new PrivateKeySigner({
        privateJwk : keyPair.privateJwk,
        algorithm  : keyPair.privateJwk.alg,
        keyId      : `${did}#${keyId}`,
      })
    };

    return persona;
  }

  /**
   * Generates a ProtocolsConfigure message for testing.
   * Optional parameters are generated if not given.
   * Implementation currently uses `ProtocolsConfigure.create()`.
   */
  public static async generateProtocolsConfigure(
    input?: GenerateProtocolsConfigureInput
  ): Promise<GenerateProtocolsConfigureOutput> {
    const author = input?.author ?? await TestDataGenerator.generatePersona();

    // generate protocol types and  definition if not given
    let definition = input?.protocolDefinition;
    if (!definition) {
      const generatedLabel = 'record' + TestDataGenerator.randomString(10);

      definition = {
        protocol  : TestDataGenerator.randomString(20),
        published : input?.published ?? false,
        types     : {},
        structure : {}
      };
      definition.types[generatedLabel] = {
        schema      : `test-object`,
        dataFormats : ['text/plain']
      };
      definition.structure[generatedLabel] = {};
    }

    const signer = Jws.createSigner(author);

    const options: ProtocolsConfigureOptions = {
      messageTimestamp  : input?.messageTimestamp,
      definition,
      signer,
      permissionGrantId : input?.permissionGrantId
    };

    const protocolsConfigure = await ProtocolsConfigure.create(options);

    return {
      author,
      message: protocolsConfigure.message,
      protocolsConfigure
    };
  };

  /**
   * Generates a ProtocolsQuery message for testing.
   */
  public static async generateProtocolsQuery(input?: GenerateProtocolsQueryInput): Promise<GenerateProtocolsQueryOutput> {
    // generate author persona if not given
    const author = input?.author ?? await TestDataGenerator.generatePersona();

    const signer = Jws.createSigner(author);

    const options: ProtocolsQueryOptions = {
      messageTimestamp  : input?.messageTimestamp,
      filter            : input?.filter,
      signer,
      permissionGrantId : input?.permissionGrantId,
    };
    removeUndefinedProperties(options);

    const protocolsQuery = await ProtocolsQuery.create(options);

    return {
      author,
      message: protocolsQuery.message,
      protocolsQuery
    };
  };

  public static async generateGrantCreate(input?: GenerateGrantCreateInput): Promise<GenerateGrantCreateOutput> {
    const author = input?.author ?? await TestDataGenerator.generatePersona();
    const grantedToPersona = input?.grantedTo ?? await TestDataGenerator.generatePersona();
    const dateExpires = input?.dateExpires ?? Time.createOffsetTimestamp({ seconds: 10 });
    const scope = input?.scope ?? {
      interface : DwnInterfaceName.Events,
      method    : DwnMethodName.Query
    };

    const signer = Jws.createSigner(author);
    const grantedTo = grantedToPersona.did;

    const options: PermissionGrantCreateOptions = {
      signer,
      grantedTo,
      dateExpires,
      scope,
      description : input?.description ?? TestDataGenerator.randomString(10),
      delegated   : input?.delegated ?? false,
      requestId   : input?.requestId,
      conditions  : input?.conditions,
    };

    const grant = await PermissionsProtocol.createGrant(options);
    const dataStream = DataStream.fromBytes(grant.permissionGrantBytes);

    return {
      dataStream,
      recordsWrite       : grant.recordsWrite,
      dataBytes          : grant.permissionGrantBytes,
      message            : grant.recordsWrite.message,
      dataEncodedMessage : grant.dataEncodedMessage
    };
  };

  /**
   * Generates a RecordsWrite message for testing.
   * Implementation currently uses `RecordsWrite.create()`.
   * @param input.attesters Attesters of the message. Will NOT be generated if not given.
   * @param input.data Data that belongs to the record. Generated when not given only if `dataCid` and `dataSize` are also not given.
   * @param input.dataFormat Format of the data. Defaults to 'application/json' if not given.
   * @param input.signer Signer of the message. Generated if not given.
   * @param input.schema Schema of the message. Randomly generated if not given.
   */
  public static async generateRecordsWrite(input?: GenerateRecordsWriteInput): Promise<GenerateRecordsWriteOutput> {
    const author = input?.author ?? await TestDataGenerator.generatePersona();

    const signer = Jws.createSigner(author);
    const attestationSigners = Jws.createSigners(input?.attesters ?? []);

    const dataCid = input?.dataCid;
    const dataSize = input?.dataSize;
    let dataBytes;
    let dataStream;
    if (dataCid === undefined && dataSize === undefined) {
      dataBytes = input?.data ?? TestDataGenerator.randomBytes(32);
      dataStream = DataStream.fromBytes(dataBytes);
    }

    const options: RecordsWriteOptions = {
      recipient         : input?.recipient,
      protocol          : input?.protocol,
      protocolPath      : input?.protocolPath,
      protocolRole      : input?.protocolRole,
      schema            : input?.schema ?? `http://${TestDataGenerator.randomString(20)}`,
      tags              : input?.tags,
      recordId          : input?.recordId,
      parentContextId   : input?.parentContextId,
      published         : input?.published,
      dataFormat        : input?.dataFormat ?? 'application/json',
      dateCreated       : input?.dateCreated,
      messageTimestamp  : input?.messageTimestamp,
      datePublished     : input?.datePublished,
      data              : dataBytes,
      dataCid,
      dataSize,
      signer,
      attestationSigners,
      encryptionInput   : input?.encryptionInput,
      permissionGrantId : input?.permissionGrantId,
    };

    const recordsWrite = await RecordsWrite.create(options);
    const message = recordsWrite.message;

    return {
      author,
      message,
      dataCid,
      dataSize,
      dataBytes,
      dataStream,
      recordsWrite
    };
  };

  /**
   * Generates a encrypted RecordsWrite message for testing.
   *
   * @param input.protocolDefinition Protocol definition used to generate the RecordsWrite.
   *        Must be the RECIPIENT's protocol definition if `encryptSymmetricKeyWithProtocolPathDerivedKey` is true,
   *        because the recipient's public keys will be needed to encrypt the symmetric key.
   *
   * @param input.encryptSymmetricKeyWithProtocolPathDerivedKey
   *        Set to `true` to attach the symmetric key encrypted by the protocol path derived public key
   *
   * @param input.encryptSymmetricKeyWithProtocolContextDerivedKey
   *        Set to `true` to attach the symmetric key encrypted by the protocol context derived public key
   */
  public static async generateProtocolEncryptedRecordsWrite(input: {
    plaintextBytes: Uint8Array,
    author: Persona,
    recipient?: string,
    protocolDefinition: ProtocolDefinition,
    protocolPath: string,
    protocolParentContextId?: string,
    protocolContextDerivingRootKeyId?: string,
    protocolContextDerivedPublicJwk?: PublicJwk,
    encryptSymmetricKeyWithProtocolPathDerivedKey: boolean,
    encryptSymmetricKeyWithProtocolContextDerivedKey: boolean,
  }): Promise<{
    message: RecordsWriteMessage;
    dataStream: Readable;
    recordsWrite: RecordsWrite;
    encryptionInput: EncryptionInput;
    encryptedDataBytes: Uint8Array;
  }> {
    const {
      plaintextBytes,
      author,
      recipient,
      protocolDefinition,
      protocolPath,
      protocolParentContextId,
      protocolContextDerivingRootKeyId,
      protocolContextDerivedPublicJwk,
    } = input;

    // encrypt the plaintext data for the target with a randomly generated symmetric key
    const plaintextStream = DataStream.fromBytes(plaintextBytes);
    const dataEncryptionInitializationVector = TestDataGenerator.randomBytes(16);
    const dataEncryptionKey = TestDataGenerator.randomBytes(32);
    const encryptedDataStream = await Encryption.aes256CtrEncrypt(
      dataEncryptionKey, dataEncryptionInitializationVector, plaintextStream
    );
    const encryptedDataBytes = await DataStream.toBytes(encryptedDataStream);

    // author generates a RecordsWrite using the encrypted data
    const protocolPathSegments = protocolPath.split('/');
    const recordType = protocolPathSegments[protocolPathSegments.length - 1];
    const { message, dataStream, recordsWrite } = await TestDataGenerator.generateRecordsWrite(
      {
        author,
        recipient,
        protocol        : protocolDefinition.protocol,
        protocolPath,
        parentContextId : protocolParentContextId,
        schema          : protocolDefinition.types[recordType].schema,
        dataFormat      : protocolDefinition.types[recordType].dataFormats?.[0],
        data            : encryptedDataBytes
      }
    );

    // final encryption input (`keyEncryptionInputs` to be populated below)
    const encryptionInput: EncryptionInput = {
      initializationVector : dataEncryptionInitializationVector,
      key                  : dataEncryptionKey,
      keyEncryptionInputs  : []
    };

    if (input.encryptSymmetricKeyWithProtocolPathDerivedKey) {
      // locate the rule set corresponding the protocol path of the message
      let protocolRuleSetSegment = protocolDefinition.structure;
      for (const pathSegment of protocolPathSegments) {
        protocolRuleSetSegment = protocolRuleSetSegment[pathSegment];
      }

      const protocolPathDerivedPublicJwk = protocolRuleSetSegment.$encryption?.publicKeyJwk;
      const protocolPathDerivationRootKeyId = protocolRuleSetSegment.$encryption?.rootKeyId;
      const protocolPathDerivedKeyEncryptionInput: KeyEncryptionInput = {
        publicKeyId      : protocolPathDerivationRootKeyId,
        publicKey        : protocolPathDerivedPublicJwk!,
        derivationScheme : KeyDerivationScheme.ProtocolPath
      };

      encryptionInput.keyEncryptionInputs.push(protocolPathDerivedKeyEncryptionInput);
    }

    if (input.encryptSymmetricKeyWithProtocolContextDerivedKey) {
      // generate key encryption input that will encrypt the symmetric encryption key using protocol-context derived public key
      let protocolContextDerivedKeyEncryptionInput: KeyEncryptionInput;
      if (protocolParentContextId === undefined) {
      // author generates protocol-context derived public key for encrypting symmetric key
        const authorRootPrivateKey: DerivedPrivateJwk = {
          rootKeyId         : author.keyId,
          derivationScheme  : KeyDerivationScheme.ProtocolContext,
          derivedPrivateKey : author.keyPair.privateJwk
        };

        const contextId = await RecordsWrite.getEntryId(author.did, message.descriptor);
        const contextDerivationPath = Records.constructKeyDerivationPathUsingProtocolContextScheme(contextId);
        const authorGeneratedProtocolContextDerivedPublicJwk = await HdKey.derivePublicKey(authorRootPrivateKey, contextDerivationPath);

        protocolContextDerivedKeyEncryptionInput = {
          publicKeyId      : author.keyId,
          publicKey        : authorGeneratedProtocolContextDerivedPublicJwk,
          derivationScheme : KeyDerivationScheme.ProtocolContext
        };
      } else {
        if (protocolContextDerivingRootKeyId === undefined ||
          protocolContextDerivedPublicJwk === undefined) {
          throw new Error ('`protocolContextDerivingRootKeyId` and `protocolContextDerivedPublicJwk` must both be defined if `protocolContextId` is given');
        }

        protocolContextDerivedKeyEncryptionInput = {
          publicKeyId      : protocolContextDerivingRootKeyId!,
          publicKey        : protocolContextDerivedPublicJwk!,
          derivationScheme : KeyDerivationScheme.ProtocolContext
        };
      }

      encryptionInput.keyEncryptionInputs.push(protocolContextDerivedKeyEncryptionInput);
    }

    await recordsWrite.encryptSymmetricEncryptionKey(encryptionInput);
    await recordsWrite.sign({ signer: Jws.createSigner(author) });

    return { message, dataStream: dataStream!, recordsWrite, encryptedDataBytes, encryptionInput };
  }

  /**
   * Generates a valid RecordsWrite that modifies the given an existing write.
   * Any mutable property is not specified will be automatically mutated.
   * e.g. if `published` is not specified, it will be toggled from the state of the given existing write.
   */
  public static async generateFromRecordsWrite(input: GenerateFromRecordsWriteInput): Promise<GenerateFromRecordsWriteOut> {
    const existingMessage = input.existingWrite.message;
    const currentTime = Time.getCurrentTimestamp();

    const published = input.published ?? existingMessage.descriptor.published ? false : true; // toggle from the parent value if not given explicitly
    const datePublished = input.datePublished ?? (published ? currentTime : undefined);

    const dataBytes = input.data ?? TestDataGenerator.randomBytes(32);
    const dataStream = DataStream.fromBytes(dataBytes);

    const options: CreateFromOptions = {
      recordsWriteMessage : input.existingWrite.message,
      data                : dataBytes,
      published,
      datePublished,
      messageTimestamp    : input.messageTimestamp,
      protocolRole        : input.protocolRole,
      tags                : input.tags,
      signer              : Jws.createSigner(input.author)
    };

    const recordsWrite = await RecordsWrite.createFrom(options);
    return {
      message: recordsWrite.message,
      recordsWrite,
      dataBytes,
      dataStream
    };
  }

  /**
   * Generates a RecordsQuery message for testing.
   */
  public static async generateRecordsQuery(input?: GenerateRecordsQueryInput): Promise<GenerateRecordsQueryOutput> {
    let author = input?.author;
    const anonymous: boolean = input?.anonymous ?? false;

    if (anonymous && author) {
      throw new Error('Cannot have `author` and be anonymous at the same time.');
    }

    // generate author if needed
    if (author === undefined && !anonymous) {
      author = await TestDataGenerator.generatePersona();
    }

    let signer = undefined;
    if (author !== undefined) {
      signer = Jws.createSigner(author);
    }

    const options: RecordsQueryOptions = {
      messageTimestamp : input?.messageTimestamp,
      signer,
      filter           : input?.filter ?? { schema: TestDataGenerator.randomString(10) }, // must have one filter property if no filter is given
      dateSort         : input?.dateSort,
      pagination       : input?.pagination,
      protocolRole     : input?.protocolRole,
    };
    removeUndefinedProperties(options);

    const recordsQuery = await RecordsQuery.create(options);
    const message = recordsQuery.message;

    return {
      author,
      message
    };
  };

  /**
   * Generates a RecordsSubscribe message for testing.
   */
  public static async generateRecordsSubscribe(input?: GenerateRecordsSubscribeInput): Promise<GenerateRecordsSubscribeOutput> {
    let author = input?.author;
    const anonymous: boolean = input?.anonymous ?? false;

    if (anonymous && author) {
      throw new Error('Cannot have `author` and be anonymous at the same time.');
    }

    // generate author if needed
    if (author === undefined && !anonymous) {
      author = await TestDataGenerator.generatePersona();
    }

    let signer = undefined;
    if (author !== undefined) {
      signer = Jws.createSigner(author);
    }

    const options: RecordsSubscribeOptions = {
      messageTimestamp : input?.messageTimestamp,
      signer,
      filter           : input?.filter ?? { schema: TestDataGenerator.randomString(10) }, // must have one filter property if no filter is given
      protocolRole     : input?.protocolRole,
    };
    removeUndefinedProperties(options);

    const recordsSubscribe = await RecordsSubscribe.create(options);
    const message = recordsSubscribe.message;

    return {
      author,
      message
    };
  }

  /**
   * Generates a RecordsDelete for testing.
   */
  public static async generateRecordsDelete(input?: GenerateRecordsDeleteInput): Promise<GenerateRecordsDeleteOutput> {
    const author = input?.author ?? await TestDataGenerator.generateDidKeyPersona();

    const recordsDelete = await RecordsDelete.create({
      recordId     : input?.recordId ?? await TestDataGenerator.randomCborSha256Cid(),
      protocolRole : input?.protocolRole,
      signer       : Jws.createSigner(author)
    });

    return {
      author,
      recordsDelete,
      message: recordsDelete.message
    };
  }

  public static async generateEventsQuery(input: GenerateEventsQueryInput): Promise<GenerateEventsQueryOutput> {
    const { filters, cursor, permissionGrantId } = input;
    const author = input.author ?? await TestDataGenerator.generatePersona();
    const signer = Jws.createSigner(author);

    const options: EventsQueryOptions = { signer, filters, cursor, permissionGrantId };
    const eventsQuery = await EventsQuery.create(options);

    return {
      author,
      eventsQuery,
      message: eventsQuery.message
    };
  }

  /**
   * Generates a EventsSubscribe message for testing.
   */
  public static async generateEventsSubscribe(input?: GenerateEventsSubscribeInput): Promise<GenerateEventsSubscribeOutput> {
    const author = input?.author ?? await TestDataGenerator.generatePersona();
    const signer = Jws.createSigner(author);

    const options: EventsSubscribeOptions = {
      filters           : input?.filters,
      messageTimestamp  : input?.messageTimestamp,
      permissionGrantId : input?.permissionGrantId,
      signer,
    };
    removeUndefinedProperties(options);

    const eventsSubscribe = await EventsSubscribe.create(options);
    const message = eventsSubscribe.message;

    return {
      author,
      eventsSubscribe,
      message
    };
  }

  public static async generateMessagesGet(input: GenerateMessagesGetInput): Promise<GenerateMessagesGetOutput> {
    const author = input?.author ?? await TestDataGenerator.generatePersona();
    const signer = Jws.createSigner(author);

    const options: MessagesGetOptions = {
      signer,
      messageCid: input.messageCid
    };

    const messagesGet = await MessagesGet.create(options);

    return {
      author,
      messagesGet,
      message: messagesGet.message,
    };
  }

  /**
   * Generates a dummy `authorization` property for a DWN message that only conforms to schema validation.
   */
  public static generateAuthorization(): AuthorizationModel {
    return {
      signature: TestDataGenerator.generateAuthorizationSignature()
    };
  }

  /**
   * Generates a dummy `authorization` property for a DWN message that only conforms to schema validation.
   */
  public static generateAuthorizationSignature(): GeneralJws {
    return {
      payload    : 'anyPayload',
      signatures : [{
        protected : 'anyProtectedHeader',
        signature : 'anySignature'
      }]
    };
  }

  /**
   * Generates a random but well-formed signature string in Base64Url format.
   */
  public static async randomSignatureString(): Promise<string> {
    const keyPair = await ed25519.generateKeyPair();
    const signatureBytes = await ed25519.sign(TestDataGenerator.randomBytes(32), keyPair.privateJwk);
    const signatureString = Encoder.bytesToBase64Url(signatureBytes);
    return signatureString;
  }


  /**
   * Generates a random alpha-numeric string.
   */
  public static randomString(length: number): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    // pick characters randomly
    let randomString = '';
    for (let i = 0; i < length; i++) {
      randomString += charset.charAt(Math.floor(Math.random() * charset.length));
    }

    return randomString;
  };

  /**
   * Generates a random byte array of given length.
   */
  public static randomBytes(length: number): Uint8Array {
    const randomBytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }

    return randomBytes;
  };

  /**
   * Generates a random CBOR SHA256 CID.
   */
  public static async randomCborSha256Cid(): Promise<string> {
    const randomBytes = TestDataGenerator.randomBytes(32);
    const randomMultihash = await sha256.digest(randomBytes);
    const cid = await CID.createV1(cbor.code, randomMultihash);
    return cid.toString();
  }

  /**
   * Generates a random within a range (inclusive).
   * @param min lowest potential value.
   * @param max greatest potential value.
   */
  public static randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min) + min);
  }

  /**
   * Generates a random timestamp. Optionally allows you to set specific non-randomized values for the timestamp.
   *
   * @returns random UTC ISO-8601 timestamp
   */
  public static randomTimestamp(options?: {
    year?: number, month?: number, day?: number, hour?: number, minute?: number, second?: number, millisecond?: number, microsecond?: number
  }): string {
    const { year, month, day, hour, minute, second, millisecond, microsecond } = options || {};
    return Time.createTimestamp({
      year        : year || this.randomInt(2000, 2022),
      month       : month || this.randomInt(1, 12),
      day         : day || this.randomInt(1, 28),
      hour        : hour || this.randomInt(0, 23),
      minute      : minute || this.randomInt(0, 59),
      second      : second || this.randomInt(0, 59),
      millisecond : millisecond || this.randomInt(0, 1000),
      microsecond : microsecond || this.randomInt(0, 1000)
    });
  }

  /**
   * Creates a mock DID resolution result for testing purposes.
   */
  public static createDidResolutionResult(persona: Persona): DidResolutionResult {
    return {
      didResolutionMetadata : {},
      didDocument           : {
        id                 : persona.did,
        verificationMethod : [{
          controller   : persona.did,
          id           : persona.keyId,
          type         : 'JsonWebKey2020',
          // TODO: #672 - port and use type from @web5/crypto - https://github.com/TBD54566975/dwn-sdk-js/issues/672
          publicKeyJwk : persona.keyPair.publicJwk as any
        }]
      },
      didDocumentMetadata: {}
    };
  }

  /**
   * Generates a did:key persona.
   */
  public static async generateDidKeyPersona(): Promise<Persona> {

    const did = await DidKey.create();
    const signingMethod = await DidKey.getSigningMethod({ didDocument: did.document });
    const keyId = signingMethod.id;
    const portableDid = await did.export();
    const keyPair = {
      // TODO: #672 - port and use type from @web5/crypto - https://github.com/TBD54566975/dwn-sdk-js/issues/672
      publicJwk  : signingMethod.publicKeyJwk as PublicJwk,
      privateJwk : portableDid.privateKeys![0] as PrivateJwk,
    };

    return {
      did    : did.uri,
      keyId,
      keyPair,
      signer : new PrivateKeySigner({
        privateJwk : keyPair.privateJwk,
        algorithm  : keyPair.privateJwk.alg,
        keyId
      })
    };
  }
}