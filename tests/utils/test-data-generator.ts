import type { DidResolutionResult } from '../../src/did/did-resolver.js';
import type { Readable } from 'readable-stream';
import type { RecordsQueryFilter } from '../../src/types/records-types.js';
import type { CreateFromOptions, EncryptionInput } from '../../src/interfaces/records-write.js';
import type {
  DateSort,
  EventsGetMessage,
  EventsGetOptions,
  HooksWriteMessage,
  HooksWriteOptions,
  MessagesGetMessage,
  MessagesGetOptions,
  ProtocolDefinition,
  ProtocolsConfigureMessage,
  ProtocolsConfigureOptions,
  ProtocolsQueryMessage,
  ProtocolsQueryOptions,
  RecordsDeleteMessage,
  RecordsQueryMessage,
  RecordsQueryOptions,
  RecordsWriteMessage,
  RecordsWriteOptions
} from '../../src/index.js';
import {
  DwnInterfaceName,
  DwnMethodName
} from '../../src/index.js';
import type { PermissionConditions, PermissionScope, PermissionsGrantMessage, PermissionsRequestMessage } from '../../src/types/permissions-types.js';
import type { PrivateJwk, PublicJwk } from '../../src/types/jose-types.js';


import * as cbor from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';
import { DataStream } from '../../src/utils/data-stream.js';
import { getCurrentTimeInHighPrecision } from '../../src/utils/time.js';
import { PermissionsGrant } from '../../src/interfaces/permissions-grant.js';
import { PermissionsRequest } from '../../src/interfaces/permissions-request.js';
import { removeUndefinedProperties } from '../../src/utils/object.js';
import { Secp256k1 } from '../../src/utils/secp256k1.js';
import { sha256 } from 'multiformats/hashes/sha2';

import {
  DidKeyResolver,
  EventsGet,
  HooksWrite,
  Jws,
  MessagesGet,
  ProtocolsConfigure,
  ProtocolsQuery,
  RecordsDelete,
  RecordsQuery,
  RecordsWrite
} from '../../src/index.js';

/**
 * A logical grouping of user data used to generate test messages.
 */
export type Persona = {
  did: string;
  keyId: string;
  keyPair: { publicJwk: PublicJwk, privateJwk: PrivateJwk };
};

export type GenerateProtocolsConfigureInput = {
  author?: Persona;
  messageTimestamp?: string;
  protocolDefinition?: ProtocolDefinition;
};

export type GenerateProtocolsConfigureOutput = {
  author: Persona;
  message: ProtocolsConfigureMessage;
  dataStream?: Readable;
  protocolsConfigure: ProtocolsConfigure;
};

export type GenerateProtocolsQueryInput = {
  author?: Persona;
  messageTimestamp?: string;
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
  author?: Persona;
  attesters?: Persona[];
  recipient?: string;
  protocol?: string;
  protocolPath?: string;
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
};

export type GenerateFromRecordsWriteInput = {
  author: Persona,
  existingWrite: RecordsWrite,
  data?: Uint8Array;
  published?: boolean;
  messageTimestamp?: string;
  datePublished?: string;
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
  filter?: RecordsQueryFilter;
  dateSort?: DateSort;
};

export type GenerateRecordsQueryOutput = {
  author: Persona | undefined;
  message: RecordsQueryMessage;
};

export type GenerateRecordsDeleteInput = {
  author?: Persona;
  recordId?: string;
};

export type GenerateRecordsDeleteOutput = {
  author: Persona;
  recordsDelete: RecordsDelete;
  message: RecordsDeleteMessage;
};

export type GenerateHooksWriteInput = {
  author?: Persona;
  messageTimestamp?: string;
  filter?: {
    method: string;
  }
  uri?: string;
};

export type GenerateHooksWriteOutput = {
  author: Persona;
  message: HooksWriteMessage;
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
  description?: string;
  grantedTo?: string;
  grantedBy?: string;
  grantedFor?: string;
  permissionsRequestId?: string;
  scope?: PermissionScope;
  conditions?: PermissionConditions;
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

export type GenerateEventsGetInput = {
  author?: Persona;
  watermark?: string;
};

export type GenerateEventsGetOutput = {
  author: Persona;
  eventsGet: EventsGet;
  message: EventsGetMessage;
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
      keyPair
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
        types     : {},
        structure : {}
      };
      definition.types[generatedLabel] = {
        schema      : `test-object`,
        dataFormats : ['text/plain']
      };
      definition.structure[generatedLabel] = {};
    }

    // TODO: #139 - move protocol definition out of the descriptor - https://github.com/TBD54566975/dwn-sdk-js/issues/139
    // const dataStream = DataStream.fromObject(definition); // intentionally left here to demonstrate the pattern to use when #139 is implemented
    const dataStream = undefined;

    const authorizationSignatureInput = Jws.createSignatureInput(author);

    const options: ProtocolsConfigureOptions = {
      messageTimestamp: input?.messageTimestamp,
      definition,
      authorizationSignatureInput
    };

    const protocolsConfigure = await ProtocolsConfigure.create(options);

    return {
      author,
      message: protocolsConfigure.message,
      dataStream,
      protocolsConfigure
    };
  };

  /**
   * Generates a ProtocolsQuery message for testing.
   */
  public static async generateProtocolsQuery(input?: GenerateProtocolsQueryInput): Promise<GenerateProtocolsQueryOutput> {
    // generate author persona if not given
    const author = input?.author ?? await TestDataGenerator.generatePersona();

    const authorizationSignatureInput = Jws.createSignatureInput(author);

    const options: ProtocolsQueryOptions = {
      messageTimestamp : input?.messageTimestamp,
      filter           : input?.filter,
      authorizationSignatureInput
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
   * @param input.author Author of the message. Generated if not given.
   * @param input.schema Schema of the message. Randomly generated if not given.
   */
  public static async generateRecordsWrite(input?: GenerateRecordsWriteInput): Promise<GenerateRecordsWriteOutput> {
    const author = input?.author ?? await TestDataGenerator.generatePersona();

    const authorizationSignatureInput = Jws.createSignatureInput(author);
    const attestationSignatureInputs = Jws.createSignatureInputs(input?.attesters ?? []);

    const dataCid = input?.dataCid;
    const dataSize = input?.dataSize;
    let dataBytes;
    let dataStream;
    if (dataCid === undefined && dataSize === undefined) {
      dataBytes = input?.data ?? TestDataGenerator.randomBytes(32);
      dataStream = DataStream.fromBytes(dataBytes);
    }

    const options: RecordsWriteOptions = {
      recipient        : input?.recipient,
      protocol         : input?.protocol,
      protocolPath     : input?.protocolPath,
      contextId        : input?.contextId,
      schema           : input?.schema ?? `http://${TestDataGenerator.randomString(20)}`,
      recordId         : input?.recordId,
      parentId         : input?.parentId,
      published        : input?.published,
      dataFormat       : input?.dataFormat ?? 'application/json',
      dateCreated      : input?.dateCreated,
      messageTimestamp : input?.messageTimestamp,
      datePublished    : input?.datePublished,
      data             : dataBytes,
      dataCid,
      dataSize,
      authorizationSignatureInput,
      attestationSignatureInputs,
      encryptionInput  : input?.encryptionInput
    };

    const recordsWrite = await RecordsWrite.create(options);
    const message = recordsWrite.message as RecordsWriteMessage;

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
   * Generates a valid RecordsWrite that modifies the given an existing write.
   * Any mutable property is not specified will be automatically mutated.
   * e.g. if `published` is not specified, it will be toggled from the state of the given existing write.
   */
  public static async generateFromRecordsWrite(input: GenerateFromRecordsWriteInput): Promise<GenerateFromRecordsWriteOut> {
    const existingMessage = input.existingWrite.message;
    const currentTime = getCurrentTimeInHighPrecision();

    const published = input.published ?? existingMessage.descriptor.published ? false : true; // toggle from the parent value if not given explicitly
    const datePublished = input.datePublished ?? (published ? currentTime : undefined);

    const dataBytes = input.data ?? TestDataGenerator.randomBytes(32);
    const dataStream = DataStream.fromBytes(dataBytes);

    const options: CreateFromOptions = {
      unsignedRecordsWriteMessage : input.existingWrite.message,
      data                        : dataBytes,
      published,
      datePublished,
      messageTimestamp            : input.messageTimestamp,
      authorizationSignatureInput : Jws.createSignatureInput(input.author)
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

    let authorizationSignatureInput = undefined;
    if (author !== undefined) {
      authorizationSignatureInput = Jws.createSignatureInput(author);
    }

    const options: RecordsQueryOptions = {
      messageTimestamp : input?.messageTimestamp,
      authorizationSignatureInput,
      filter           : input?.filter ?? { schema: TestDataGenerator.randomString(10) }, // must have one filter property if no filter is given
      dateSort         : input?.dateSort
    };
    removeUndefinedProperties(options);

    const recordsQuery = await RecordsQuery.create(options);
    const message = recordsQuery.message as RecordsQueryMessage;

    return {
      author,
      message
    };
  };

  /**
   * Generates a RecordsDelete for testing.
   */
  public static async generateRecordsDelete(input?: GenerateRecordsDeleteInput): Promise<GenerateRecordsDeleteOutput> {
    const author = input?.author ?? await DidKeyResolver.generate();

    const recordsDelete = await RecordsDelete.create({
      recordId                    : input?.recordId ?? await TestDataGenerator.randomCborSha256Cid(),
      authorizationSignatureInput : Jws.createSignatureInput(author)
    });

    return {
      author,
      recordsDelete,
      message: recordsDelete.message
    };
  }

  /**
   * Generates a HooksWrite message for testing.
   */
  public static async generateHooksWrite(input?: GenerateHooksWriteInput): Promise<GenerateHooksWriteOutput> {
    const author = input?.author ?? await TestDataGenerator.generatePersona();

    const authorizationSignatureInput = Jws.createSignatureInput(author);

    const options: HooksWriteOptions = {
      messageTimestamp : input?.messageTimestamp,
      authorizationSignatureInput,
      filter           : input?.filter ?? { method: 'RecordsWrite' }, // hardcode to filter on `RecordsWrite` if no filter is given
    };
    removeUndefinedProperties(options);

    const hooksWrite = await HooksWrite.create(options);

    return {
      author,
      message: hooksWrite.message
    };
  };

  /**
   * Generates a PermissionsRequest message for testing.
   */
  public static async generatePermissionsRequest(input?: GeneratePermissionsRequestInput): Promise<GeneratePermissionsRequestOutput> {
    const author = input?.author ?? await TestDataGenerator.generatePersona();
    const permissionsRequest = await PermissionsRequest.create({
      messageTimestamp : getCurrentTimeInHighPrecision(),
      description      : input?.description,
      grantedBy        : input?.grantedBy ?? 'did:jank:bob',
      grantedTo        : input?.grantedTo ?? 'did:jank:alice',
      grantedFor       : input?.grantedFor ?? input?.grantedBy ?? 'did:jank:bob',
      scope            : input?.scope ?? {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write
      },
      conditions                  : input?.conditions,
      authorizationSignatureInput : Jws.createSignatureInput(author)
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
    const author = input?.author ?? await TestDataGenerator.generatePersona();
    const permissionsGrant = await PermissionsGrant.create({
      messageTimestamp     : getCurrentTimeInHighPrecision(),
      description          : input?.description ?? 'drugs',
      grantedBy            : input?.grantedBy ?? 'did:jank:bob',
      grantedTo            : input?.grantedTo ?? 'did:jank:alice',
      grantedFor           : input?.grantedFor ?? input?.grantedBy ?? 'did:jank:bob',
      permissionsRequestId : input?.permissionsRequestId,
      scope                : input?.scope ?? {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write
      },
      conditions                  : input?.conditions,
      authorizationSignatureInput : Jws.createSignatureInput(author)
    });

    return {
      author,
      permissionsGrant,
      message: permissionsGrant.message
    };
  }

  public static async generateEventsGet(input?: GenerateEventsGetInput): Promise<GenerateEventsGetOutput> {
    const author = input?.author ?? await TestDataGenerator.generatePersona();
    const authorizationSignatureInput = Jws.createSignatureInput(author);

    const options: EventsGetOptions = { authorizationSignatureInput };
    if (input?.watermark) {
      options.watermark = input.watermark;
    }

    const eventsGet = await EventsGet.create(options);

    return {
      author,
      eventsGet,
      message: eventsGet.message
    };
  }

  public static async generateMessagesGet(input: GenerateMessagesGetInput): Promise<GenerateMessagesGetOutput> {
    const author = input?.author ?? await TestDataGenerator.generatePersona();
    const authorizationSignatureInput = Jws.createSignatureInput(author);

    const options: MessagesGetOptions = {
      authorizationSignatureInput,
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