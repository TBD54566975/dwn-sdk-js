import type { DerivedPrivateJwk } from '../../src/utils/hd-key.js';
import type { DidResolutionResult } from '../../src/types/did-types.js';
import type { EventsGetOptions } from '../../src/interfaces/events-get.js';
import type { EventsQueryOptions } from '../../src/interfaces/events-query.js';
import type { EventsSubscribeOptions } from '../../src/interfaces/events-subscribe.js';
import type { GeneralJws } from '../../src/types/jws-types.js';
import type { MessagesGetMessage } from '../../src/types/messages-types.js';
import type { MessagesGetOptions } from '../../src/interfaces/messages-get.js';
import type { PaginationCursor } from '../../src/types/query-types.js';
import type { ProtocolsConfigureOptions } from '../../src/interfaces/protocols-configure.js';
import type { ProtocolsQueryOptions } from '../../src/interfaces/protocols-query.js';
import type { Readable } from 'readable-stream';
import type { RecordsQueryOptions } from '../../src/interfaces/records-query.js';
import type { RecordsSubscribeOptions } from '../../src/interfaces/records-subscribe.js';
import type { Signer } from '../../src/types/signer.js';
import type { AuthorizationModel, Pagination } from '../../src/types/message-types.js';
import type { CreateFromOptions, EncryptionInput, KeyEncryptionInput, RecordsWriteOptions } from '../../src/interfaces/records-write.js';
import type { DateSort, RecordsDeleteMessage, RecordsFilter, RecordsQueryMessage } from '../../src/types/records-types.js';
import type { EventsFilter, EventsGetMessage, EventsQueryMessage, EventsSubscribeMessage } from '../../src/types/events-types.js';
import type { PermissionConditions, PermissionScope } from '../../src/types/permissions-grant-descriptor.js';
import type { PermissionsGrantMessage, PermissionsRequestMessage, PermissionsRevokeMessage } from '../../src/types/permissions-types.js';
import type { PrivateJwk, PublicJwk } from '../../src/types/jose-types.js';
import type { ProtocolDefinition, ProtocolsConfigureMessage, ProtocolsQueryMessage } from '../../src/types/protocols-types.js';
import type { RecordsSubscribeMessage, RecordsWriteMessage } from '../../src/types/records-types.js';


import * as cbor from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';
import { DataStream } from '../../src/utils/data-stream.js';
import { DidKeyResolver } from '../../src/did/did-key-resolver.js';
import { Encryption } from '../../src/utils/encryption.js';
import { EventsGet } from '../../src/interfaces/events-get.js';
import { EventsQuery } from '../../src/interfaces/events-query.js';
import { EventsSubscribe } from '../../src/interfaces/events-subscribe.js';
import { Jws } from '../../src/utils/jws.js';
import { MessagesGet } from '../../src/interfaces/messages-get.js';
import { PermissionsGrant } from '../../src/interfaces/permissions-grant.js';
import { PermissionsRequest } from '../../src/interfaces/permissions-request.js';
import { PermissionsRevoke } from '../../src/interfaces/permissions-revoke.js';
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
  permissionsGrantId?: string;
};

export type GenerateProtocolsConfigureOutput = {
  author: Persona;
  message: ProtocolsConfigureMessage;
  protocolsConfigure: ProtocolsConfigure;
};

export type GenerateProtocolsQueryInput = {
  author?: Persona;
  messageTimestamp?: string;
  permissionsGrantId?: string;
  filter?: {
    protocol: string;
  }
};

export type GenerateProtocolsQueryOutput = {
  author: Persona;
  message: ProtocolsQueryMessage;
  protocolsQuery: ProtocolsQuery;
};

export type GenerateRecordsWriteInput = {
  // Will refactor only when the PR is reviewed approved to avoid polluting the PR.
  author?: Persona;
  attesters?: Persona[];
  recipient?: string;
  protocol?: string;
  protocolPath?: string;
  protocolRole?: string;
  contextId?: string;
  schema?: string;
  recordId?: string;
  parentId?: string;
  published?: boolean;
  data?: Uint8Array;
  dataCid?: string;
  dataSize?: number;
  dataFormat?: string;
  dateCreated?: string;
  messageTimestamp?: string;
  datePublished?: string;
  encryptionInput?: EncryptionInput;
  permissionsGrantId?: string;
};

export type GenerateFromRecordsWriteInput = {
  author: Persona,
  existingWrite: RecordsWrite,
  data?: Uint8Array;
  published?: boolean;
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

export type GeneratePermissionsRequestInput = {
  author: Persona;
  messageTimestamp?: string;
  description?: string;
  grantedTo?: string;
  grantedBy?: string;
  grantedFor?: string;
  scope?: PermissionScope;
  conditions?: PermissionConditions;
};

export type GeneratePermissionsGrantInput = {
  author: Persona;
  messageTimestamp?: string;
  dateExpires?: string;
  description?: string;
  grantedTo?: string;
  grantedBy?: string;
  grantedFor?: string;
  permissionsRequestId?: string;
  scope?: PermissionScope;
  conditions?: PermissionConditions;
};

export type GeneratePermissionsRevokeInput = {
  author: Persona;
  dateCreated?: string;
  permissionsGrantId?: string;
};

export type GeneratePermissionsRequestOutput = {
  author: Persona;
  permissionsRequest: PermissionsRequest;
  message: PermissionsRequestMessage;
};

export type GeneratePermissionsGrantOutput = {
  author: Persona;
  permissionsGrant: PermissionsGrant;
  message: PermissionsGrantMessage;
};

export type GeneratePermissionsRevokeOutput = {
  author: Persona;
  permissionsRevoke: PermissionsRevoke;
  message: PermissionsRevokeMessage;
};

export type GenerateEventsGetInput = {
  author?: Persona;
  cursor?: PaginationCursor;
};

export type GenerateEventsGetOutput = {
  author: Persona;
  eventsGet: EventsGet;
  message: EventsGetMessage;
};

export type GenerateEventsQueryInput = {
  author?: Persona;
  filters: EventsFilter[];
  cursor?: PaginationCursor;
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
};

export type GenerateEventsSubscribeOutput = {
  author: Persona;
  eventsSubscribe: EventsSubscribe;
  message: EventsSubscribeMessage;
};

export type GenerateMessagesGetInput = {
  author?: Persona;
  messageCids: string[]
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
      messageTimestamp   : input?.messageTimestamp,
      definition,
      signer,
      permissionsGrantId : input?.permissionsGrantId
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
      messageTimestamp   : input?.messageTimestamp,
      filter             : input?.filter,
      signer,
      permissionsGrantId : input?.permissionsGrantId,
    };
    removeUndefinedProperties(options);

    const protocolsQuery = await ProtocolsQuery.create(options);

    return {
      author,
      message: protocolsQuery.message,
      protocolsQuery
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
      recipient          : input?.recipient,
      protocol           : input?.protocol,
      protocolPath       : input?.protocolPath,
      protocolRole       : input?.protocolRole,
      contextId          : input?.contextId,
      schema             : input?.schema ?? `http://${TestDataGenerator.randomString(20)}`,
      recordId           : input?.recordId,
      parentId           : input?.parentId,
      published          : input?.published,
      dataFormat         : input?.dataFormat ?? 'application/json',
      dateCreated        : input?.dateCreated,
      messageTimestamp   : input?.messageTimestamp,
      datePublished      : input?.datePublished,
      data               : dataBytes,
      dataCid,
      dataSize,
      signer,
      attestationSigners,
      encryptionInput    : input?.encryptionInput,
      permissionsGrantId : input?.permissionsGrantId,
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
    protocolContextId?: string,
    protocolContextDerivingRootKeyId?: string,
    protocolContextDerivedPublicJwk?: PublicJwk,
    protocolParentId?: string,
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
      protocolContextId,
      protocolContextDerivingRootKeyId,
      protocolContextDerivedPublicJwk,
      protocolParentId,
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
        protocol   : protocolDefinition.protocol,
        protocolPath,
        contextId  : protocolContextId,
        parentId   : protocolParentId,
        schema     : protocolDefinition.types[recordType].schema,
        dataFormat : protocolDefinition.types[recordType].dataFormats?.[0],
        data       : encryptedDataBytes
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
      // generate key encryption input to that will encrypt the symmetric encryption key using protocol-context derived public key
      let protocolContextDerivedKeyEncryptionInput: KeyEncryptionInput;
      if (protocolContextId === undefined) {
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
    const author = input?.author ?? await DidKeyResolver.generate();

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

  /**
   * Generates a PermissionsRequest message for testing.
   */
  public static async generatePermissionsRequest(input?: GeneratePermissionsRequestInput): Promise<GeneratePermissionsRequestOutput> {
    const author = input?.author ?? await TestDataGenerator.generatePersona();
    const permissionsRequest = await PermissionsRequest.create({
      messageTimestamp : Time.getCurrentTimestamp(),
      description      : input?.description,
      grantedBy        : input?.grantedBy ?? 'did:jank:bob',
      grantedTo        : input?.grantedTo ?? 'did:jank:alice',
      grantedFor       : input?.grantedFor ?? input?.grantedBy ?? 'did:jank:bob',
      scope            : input?.scope ?? {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write
      },
      conditions : input?.conditions,
      signer     : Jws.createSigner(author)
    });

    return {
      author,
      permissionsRequest,
      message: permissionsRequest.message
    };
  }

  /**
   * Generates a PermissionsGrant message for testing.
   */
  public static async generatePermissionsGrant(input?: GeneratePermissionsGrantInput): Promise<GeneratePermissionsGrantOutput> {
    const dateExpires = input?.dateExpires ?? Time.createOffsetTimestamp({ seconds: 60 * 60 * 24 });
    const author = input?.author ?? await TestDataGenerator.generatePersona();
    const permissionsGrant = await PermissionsGrant.create({
      messageTimestamp     : input?.messageTimestamp ?? Time.getCurrentTimestamp(),
      dateExpires,
      description          : input?.description ?? 'drugs',
      grantedBy            : input?.grantedBy ?? author.did,
      grantedTo            : input?.grantedTo ?? (await TestDataGenerator.generatePersona()).did,
      grantedFor           : input?.grantedFor ?? author.did,
      permissionsRequestId : input?.permissionsRequestId,
      scope                : input?.scope ?? {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write
      },
      conditions : input?.conditions,
      signer     : Jws.createSigner(author)
    });

    return {
      author,
      permissionsGrant,
      message: permissionsGrant.message
    };
  }

  /**
   * Generates a PermissionsRevoke message for testing.
   */
  public static async generatePermissionsRevoke(input?: GeneratePermissionsRevokeInput): Promise<GeneratePermissionsRevokeOutput> {
    const author = input?.author ?? await TestDataGenerator.generatePersona();
    const signer = Jws.createSigner(author);

    const permissionsRevoke = await PermissionsRevoke.create({
      signer,
      permissionsGrantId : input?.permissionsGrantId ?? await TestDataGenerator.randomCborSha256Cid(),
      messageTimestamp   : input?.dateCreated
    });

    return {
      author,
      permissionsRevoke,
      message: permissionsRevoke.message
    };
  }

  public static async generateEventsGet(input?: GenerateEventsGetInput): Promise<GenerateEventsGetOutput> {
    const author = input?.author ?? await TestDataGenerator.generatePersona();
    const signer = Jws.createSigner(author);

    const options: EventsGetOptions = { signer };
    if (input?.cursor) {
      options.cursor = input.cursor;
    }

    const eventsGet = await EventsGet.create(options);

    return {
      author,
      eventsGet,
      message: eventsGet.message
    };
  }

  public static async generateEventsQuery(input: GenerateEventsQueryInput): Promise<GenerateEventsQueryOutput> {
    const { filters, cursor } = input;
    const author = input.author ?? await TestDataGenerator.generatePersona();
    const signer = Jws.createSigner(author);

    const options: EventsQueryOptions = { signer, filters, cursor };

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
      filters          : input?.filters,
      messageTimestamp : input?.messageTimestamp,
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
      messageCids: input.messageCids
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
          publicKeyJwk : persona.keyPair.publicJwk
        }]
      },
      didDocumentMetadata: {}
    };
  }
}