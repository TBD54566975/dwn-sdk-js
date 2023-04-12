import type { BaseMessage } from '../../src/core/types.js';
import type { DidResolutionResult } from '../../src/did/did-resolver.js';
import type { Readable } from 'readable-stream';
import type { RecordsQueryFilter } from '../../src/interfaces/records/types.js';
import type { CreateFromOptions, EncryptionInput } from '../../src/interfaces/records/messages/records-write.js';
import type {
  DateSort,
  HooksWriteMessage,
  HooksWriteOptions,
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
import type { PrivateJwk, PublicJwk } from '../../src/jose/types.js';

import * as cbor from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';
import { DataStream } from '../../src/utils/data-stream.js';
import { ed25519 } from '../../src/jose/algorithms/signing/ed25519.js';
import { getCurrentTimeInHighPrecision } from '../../src/utils/time.js';
import { PermissionsRequest } from '../../src/interfaces/permissions/messages/permissions-request.js';
import { removeUndefinedProperties } from '../../src/utils/object.js';
import { Secp256k1 } from '../../src/utils/secp256k1.js';
import { sha256 } from 'multiformats/hashes/sha2';

import {
  DidKeyResolver,
  HooksWrite,
  Jws,
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
  requester?: Persona;
  dateCreated?: string;
  protocol?: string;
  protocolDefinition?: ProtocolDefinition;
};

export type GenerateProtocolsConfigureOutput = {
  requester: Persona;
  message: ProtocolsConfigureMessage;
  dataStream?: Readable;
  protocolsConfigure: ProtocolsConfigure;
};

export type GenerateProtocolsQueryInput = {
  requester?: Persona;
  dateCreated?: string;
  filter?: {
    protocol: string;
  }
};

export type GenerateProtocolsQueryOutput = {
  requester: Persona;
  message: ProtocolsQueryMessage;
  protocolsQuery: ProtocolsQuery;
};

export type GenerateRecordsWriteInput = {
  requester?: Persona;
  attesters?: Persona[];
  recipientDid?: string;
  protocol?: string;
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
  dateModified?: string;
  datePublished?: string;
  encryptionInput?: EncryptionInput;
};

export type GenerateFromRecordsWriteInput = {
  requester: Persona,
  existingWrite: RecordsWrite,
  data?: Uint8Array;
  published?: boolean;
  dateModified?: string;
  datePublished?: string;
};

export type GenerateFromRecordsWriteOut = {
  message: RecordsWriteMessage;
  dataBytes: Uint8Array;
  dataStream: Readable;
  recordsWrite: RecordsWrite;
};

export type GenerateRecordsWriteOutput = {
  requester: Persona;
  message: RecordsWriteMessage;
  dataCid?: string;
  dataSize?: number;
  dataBytes?: Uint8Array;
  dataStream?: Readable;
  recordsWrite: RecordsWrite;
};

export type GenerateRecordsQueryInput = {
  requester?: Persona;
  dateCreated?: string;
  filter?: RecordsQueryFilter;
  dateSort?: DateSort;
};

export type GenerateRecordsQueryOutput = {
  requester: Persona;
  message: RecordsQueryMessage;
};

export type GenerateRecordsDeleteInput = {
  requester?: Persona;
  recordId?: string;
};

export type GenerateRecordsDeleteOutput = {
  requester: Persona;
  recordsDelete: RecordsDelete;
  message: RecordsDeleteMessage;
};

export type GenerateHooksWriteInput = {
  requester?: Persona;
  dateCreated?: string;
  filter?: {
    method: string;
  }
  uri?: string;
};

export type GenerateHooksWriteOutput = {
  requester: Persona;
  message: HooksWriteMessage;
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

    // generate requester key ID if not given
    const keyIdSuffix = TestDataGenerator.randomString(10);
    const keyId = input?.keyId ?? `${did}#${keyIdSuffix}`;

    // generate requester key pair if not given
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

    const requester = input?.requester ?? await TestDataGenerator.generatePersona();

    // generate protocol definition if not given
    let definition = input?.protocolDefinition;
    if (!definition) {
      const generatedLabel = 'record' + TestDataGenerator.randomString(10);

      definition = {
        labels  : {},
        records : {}
      };
      definition.labels[generatedLabel] = { schema: `test-object` };
      definition.records[generatedLabel] = {};
    }

    // TODO: #139 - move protocol definition out of the descriptor - https://github.com/TBD54566975/dwn-sdk-js/issues/139
    // const dataStream = DataStream.fromObject(definition); // intentionally left here to demonstrate the pattern to use when #139 is implemented
    const dataStream = undefined;

    const authorizationSignatureInput = Jws.createSignatureInput(requester);

    const options: ProtocolsConfigureOptions = {
      dateCreated : input?.dateCreated,
      protocol    : input?.protocol ?? TestDataGenerator.randomString(20),
      definition,
      authorizationSignatureInput
    };

    const protocolsConfigure = await ProtocolsConfigure.create(options);

    return {
      requester,
      message: protocolsConfigure.message,
      dataStream,
      protocolsConfigure
    };
  };

  /**
   * Generates a ProtocolsQuery message for testing.
   */
  public static async generateProtocolsQuery(input?: GenerateProtocolsQueryInput): Promise<GenerateProtocolsQueryOutput> {
    // generate requester persona if not given
    const requester = input?.requester ?? await TestDataGenerator.generatePersona();

    const authorizationSignatureInput = Jws.createSignatureInput(requester);

    const options: ProtocolsQueryOptions = {
      dateCreated : input?.dateCreated,
      filter      : input?.filter,
      authorizationSignatureInput
    };
    removeUndefinedProperties(options);

    const protocolsQuery = await ProtocolsQuery.create(options);

    return {
      requester,
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
   * @param input.requester Author of the message. Generated if not given.
   * @param input.schema Schema of the message. Randomly generated if not given.
   */
  public static async generateRecordsWrite(input?: GenerateRecordsWriteInput): Promise<GenerateRecordsWriteOutput> {
    const requester = input?.requester ?? await TestDataGenerator.generatePersona();

    const authorizationSignatureInput = Jws.createSignatureInput(requester);
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
      recipient       : input?.recipientDid,
      protocol        : input?.protocol,
      contextId       : input?.contextId,
      schema          : input?.schema ?? TestDataGenerator.randomString(20),
      recordId        : input?.recordId,
      parentId        : input?.parentId,
      published       : input?.published,
      dataFormat      : input?.dataFormat ?? 'application/json',
      dateCreated     : input?.dateCreated,
      dateModified    : input?.dateModified,
      datePublished   : input?.datePublished,
      data            : dataBytes,
      dataCid,
      dataSize,
      authorizationSignatureInput,
      attestationSignatureInputs,
      encryptionInput : input?.encryptionInput
    };

    const recordsWrite = await RecordsWrite.create(options);
    const message = recordsWrite.message as RecordsWriteMessage;

    return {
      requester,
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
      dateModified                : input.dateModified,
      authorizationSignatureInput : Jws.createSignatureInput(input.requester)
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
    const requester = input?.requester ?? await TestDataGenerator.generatePersona();

    const authorizationSignatureInput = Jws.createSignatureInput(requester);

    const options: RecordsQueryOptions = {
      dateCreated : input?.dateCreated,
      authorizationSignatureInput,
      filter      : input?.filter ?? { schema: TestDataGenerator.randomString(10) }, // must have one filter property if no filter is given
      dateSort    : input?.dateSort
    };
    removeUndefinedProperties(options);

    const recordsQuery = await RecordsQuery.create(options);
    const message = recordsQuery.message as RecordsQueryMessage;

    return {
      requester,
      message
    };
  };

  /**
   * Generates a RecordsDelete for testing.
   */
  public static async generateRecordsDelete(input?: GenerateRecordsDeleteInput): Promise<GenerateRecordsDeleteOutput> {
    const requester = input?.requester ?? await DidKeyResolver.generate();

    const recordsDelete = await RecordsDelete.create({
      recordId                    : input?.recordId ?? await TestDataGenerator.randomCborSha256Cid(),
      authorizationSignatureInput : Jws.createSignatureInput(requester)
    });

    return {
      requester,
      recordsDelete,
      message: recordsDelete.message
    };
  }

  /**
   * Generates a HooksWrite message for testing.
   */
  public static async generateHooksWrite(input?: GenerateHooksWriteInput): Promise<GenerateHooksWriteOutput> {
    const requester = input?.requester ?? await TestDataGenerator.generatePersona();

    const authorizationSignatureInput = Jws.createSignatureInput(requester);

    const options: HooksWriteOptions = {
      dateCreated : input?.dateCreated,
      authorizationSignatureInput,
      filter      : input?.filter ?? { method: 'RecordsWrite' }, // hardcode to filter on `RecordsWrite` if no filter is given
    };
    removeUndefinedProperties(options);

    const hooksWrite = await HooksWrite.create(options);

    return {
      requester,
      message: hooksWrite.message
    };
  };

  /**
   * Generates a PermissionsRequest message for testing.
   */
  public static async generatePermissionsRequest(): Promise<{ message: BaseMessage }> {
    const { privateJwk } = await ed25519.generateKeyPair();
    const permissionRequest = await PermissionsRequest.create({
      dateCreated                 : getCurrentTimeInHighPrecision(),
      description                 : 'drugs',
      grantedBy                   : 'did:jank:bob',
      grantedTo                   : 'did:jank:alice',
      scope                       : { method: 'RecordsWrite' },
      authorizationSignatureInput : { privateJwk: privateJwk, protectedHeader: { alg: privateJwk.alg as string, kid: 'whatev' } }
    });

    return { message: permissionRequest.message };
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