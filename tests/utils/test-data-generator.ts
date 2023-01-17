import * as cbor from '@ipld/dag-cbor';
import { BaseMessage } from '../../src/core/types.js';
import { CID } from 'multiformats/cid';
import { CreateFromOptions } from '../../src/interfaces/collections/messages/collections-write.js';
import { DidResolutionResult } from '../../src/did/did-resolver.js';
import { ed25519 } from '../../src/jose/algorithms/signing/ed25519.js';
import { getCurrentTimeInHighPrecision } from '../../src/utils/time.js';
import { PermissionsRequest } from '../../src/interfaces/permissions/messages/permissions-request.js';
import { removeUndefinedProperties } from '../../src/utils/object.js';
import { secp256k1 } from '../../src/jose/algorithms/signing/secp256k1.js';
import { sha256 } from 'multiformats/hashes/sha2';
import { SignatureInput } from '../../src/jose/jws/general/types.js';
import {
  DateSort,
  HooksWrite,
  HooksWriteMessage,
  HooksWriteOptions,
  ProtocolDefinition,
  ProtocolsConfigure,
  ProtocolsConfigureMessage,
  ProtocolsConfigureOptions,
  ProtocolsQuery,
  ProtocolsQueryMessage,
  ProtocolsQueryOptions,
  RecordsQuery,
  RecordsQueryMessage,
  RecordsQueryOptions,
  RecordsWrite,
  RecordsWriteMessage,
  RecordsWriteOptions
} from '../../src/index.js';
import { PrivateJwk, PublicJwk } from '../../src/jose/types.js';

/**
 * A logical grouping of user data used to generate test messages.
 */
export type Persona = {
  did: string;
  keyId: string;
  keyPair: { publicJwk: PublicJwk, privateJwk: PrivateJwk };
};

export type GenerateProtocolsConfigureMessageInput = {
  requester?: Persona;
  target?: Persona;
  dateCreated?: string;
  protocol?: string;
  protocolDefinition?: ProtocolDefinition;
};

export type GenerateProtocolsConfigureMessageOutput = {
  requester: Persona;
  target: Persona;
  message: ProtocolsConfigureMessage;
  protocolsConfigure: ProtocolsConfigure;
};

export type GenerateProtocolsQueryMessageInput = {
  requester?: Persona;
  target?: Persona;
  dateCreated?: string;
  filter?: {
    protocol: string;
  }
};

export type GenerateProtocolsQueryMessageOutput = {
  requester: Persona;
  target: Persona;
  message: ProtocolsQueryMessage;
  protocolsQuery: ProtocolsQuery;
};

export type GenerateRecordsWriteMessageInput = {
  requester?: Persona;
  target?: Persona;
  recipientDid?: string;
  protocol?: string;
  contextId?: string;
  schema?: string;
  recordId?: string;
  parentId?: string;
  published?: boolean;
  data?: Uint8Array;
  dataFormat?: string;
  dateCreated?: string;
  dateModified?: string;
  datePublished?: string;
};

export type generateFromRecordsWriteInput = {
  requester: Persona,
  existingWrite: RecordsWrite,
  data?: Uint8Array;
  published?: boolean;
  dateModified?: string;
  datePublished?: string;
};

export type GenerateRecordsWriteMessageOutput = {
  requester: Persona;
  target: Persona;
  message: RecordsWriteMessage;
  collectionsWrite: RecordsWrite;
};

export type GenerateRecordsQueryMessageInput = {
  requester?: Persona;
  target?: Persona;
  dateCreated?: string;
  filter?: {
    recipient?: string;
    protocol?: string;
    contextId?: string;
    schema?: string;
    recordId?: string;
    parentId?: string;
    dataFormat?: string;
  }
  dateSort?: DateSort;
};

export type GenerateRecordsQueryMessageOutput = {
  requester: Persona;
  target: Persona;
  message: RecordsQueryMessage;
};

export type GenerateHooksWriteMessageInput = {
  requester?: Persona;
  target?: Persona;
  dateCreated?: string;
  filter?: {
    method: string;
  }
  uri?: string;
};

export type GenerateHooksWriteMessageOutput = {
  requester: Persona;
  target: Persona;
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
    const keyPair = input?.keyPair ?? await secp256k1.generateKeyPair();

    const persona: Persona = {
      did,
      keyId,
      keyPair
    };

    return persona;
  }

  /**
   * Creates a SignatureInput from the given Persona.
   */
  public static createSignatureInputFromPersona(persona: Persona): SignatureInput {
    const signatureInput = {
      privateJwk      : persona.keyPair.privateJwk,
      protectedHeader : {
        alg : persona.keyPair.privateJwk.alg as string,
        kid : persona.keyId
      }
    };

    return signatureInput;
  }

  /**
   * Generates a ProtocolsConfigure message for testing.
   * Optional parameters are generated if not given.
   * Implementation currently uses `ProtocolsConfigure.create()`.
   */
  public static async generateProtocolsConfigureMessage(
    input?: GenerateProtocolsConfigureMessageInput
  ): Promise<GenerateProtocolsConfigureMessageOutput> {

    const { requester, target } = await TestDataGenerator.generateRequesterAndTargetPersonas(input);

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

    const signatureInput = TestDataGenerator.createSignatureInputFromPersona(requester);

    const options: ProtocolsConfigureOptions = {
      target      : target.did,
      dateCreated : input?.dateCreated,
      protocol    : input?.protocol ?? TestDataGenerator.randomString(20),
      definition,
      signatureInput
    };

    const protocolsConfigure = await ProtocolsConfigure.create(options);

    return {
      requester,
      target,
      message: protocolsConfigure.message,
      protocolsConfigure
    };
  };

  /**
   * Generates a ProtocolsQuery message for testing.
   */
  public static async generateProtocolsQueryMessage(input?: GenerateProtocolsQueryMessageInput): Promise<GenerateProtocolsQueryMessageOutput> {
    // generate requester persona if not given
    const { requester, target } = await TestDataGenerator.generateRequesterAndTargetPersonas(input);

    const signatureInput = TestDataGenerator.createSignatureInputFromPersona(requester);

    const options: ProtocolsQueryOptions = {
      target      : target.did,
      dateCreated : input?.dateCreated,
      filter      : input?.filter,
      signatureInput
    };
    removeUndefinedProperties(options);

    const protocolsQuery = await ProtocolsQuery.create(options);

    return {
      requester,
      target,
      message: protocolsQuery.message,
      protocolsQuery
    };
  };

  /**
   * Generates a RecordsWrite message for testing.
   * Optional parameters are generated if not given.
   * If `requester` and `target` are both not given, use the same persona to pass authorization in tests by default.
   * Implementation currently uses `RecordsWrite.create()`.
   */
  public static async generateRecordsWriteMessage(input?: GenerateRecordsWriteMessageInput): Promise<GenerateRecordsWriteMessageOutput> {

    const { requester, target } = await TestDataGenerator.generateRequesterAndTargetPersonas(input);

    const signatureInput = TestDataGenerator.createSignatureInputFromPersona(requester);

    const data = input?.data ?? TestDataGenerator.randomBytes(32);

    const options: RecordsWriteOptions = {
      target        : target.did,
      recipient     : input?.recipientDid ?? target.did, // use target if recipient is not explicitly set
      protocol      : input?.protocol,
      contextId     : input?.contextId,
      schema        : input?.schema ?? TestDataGenerator.randomString(20),
      recordId      : input?.recordId,
      parentId      : input?.parentId,
      published     : input?.published,
      dataFormat    : input?.dataFormat ?? 'application/json',
      dateCreated   : input?.dateCreated,
      dateModified  : input?.dateModified,
      datePublished : input?.datePublished,
      data,
      signatureInput
    };


    const collectionsWrite = await RecordsWrite.create(options);
    const message = collectionsWrite.message as RecordsWriteMessage;

    return {
      target,
      requester,
      message,
      collectionsWrite
    };
  };

  /**
   * Generates a valid RecordsWrite that modifies the given an existing write.
   * Any mutable property is not specified will be automatically mutated.
   * e.g. if `published` is not specified, it will be toggled from the state of the given existing write.
   */
  public static async generateFromRecordsWrite(input?: generateFromRecordsWriteInput): Promise<RecordsWrite> {
    const existingMessage = input.existingWrite.message;
    const currentTime = getCurrentTimeInHighPrecision();

    const published = input.published ?? existingMessage.descriptor.published ? false : true; // toggle from the parent value if not given explicitly
    const datePublished = input.datePublished ?? (published ? currentTime : undefined);

    const options: CreateFromOptions = {
      target                      : input.existingWrite.target,
      unsignedRecordsWriteMessage : input.existingWrite.message,
      data                        : input.data ?? TestDataGenerator.randomBytes(32),
      published,
      datePublished,
      dateModified                : input.dateModified,
      signatureInput              : TestDataGenerator.createSignatureInputFromPersona(input.requester)
    };

    const collectionsWrite = await RecordsWrite.createFrom(options);
    return collectionsWrite;
  }

  /**
   * Generates a RecordsQuery message for testing.
   */
  public static async generateRecordsQueryMessage(input?: GenerateRecordsQueryMessageInput): Promise<GenerateRecordsQueryMessageOutput> {
    const { requester, target } = await TestDataGenerator.generateRequesterAndTargetPersonas(input);

    const signatureInput = TestDataGenerator.createSignatureInputFromPersona(requester);

    const options: RecordsQueryOptions = {
      target      : target.did,
      dateCreated : input?.dateCreated,
      signatureInput,
      filter      : input?.filter ?? { schema: TestDataGenerator.randomString(10) }, // must have one filter property if no filter is given
      dateSort    : input?.dateSort
    };
    removeUndefinedProperties(options);

    const collectionsQuery = await RecordsQuery.create(options);
    const message = collectionsQuery.message as RecordsQueryMessage;

    return {
      target,
      requester,
      message
    };
  };

  /**
   * Generates a HooksWrite message for testing.
   */
  public static async generateHooksWriteMessage(input?: GenerateHooksWriteMessageInput): Promise<GenerateHooksWriteMessageOutput> {

    const { requester, target } = await TestDataGenerator.generateRequesterAndTargetPersonas(input);

    const signatureInput = TestDataGenerator.createSignatureInputFromPersona(requester);

    const options: HooksWriteOptions = {
      target      : target.did,
      dateCreated : input?.dateCreated,
      signatureInput,
      filter      : input?.filter ?? { method: 'RecordsWrite' }, // hardcode to filter on `RecordsWrite` if no filter is given
    };
    removeUndefinedProperties(options);

    const hooksWrite = await HooksWrite.create(options);

    return {
      target,
      requester,
      message: hooksWrite.message
    };
  };

  /**
   * Generates a PermissionsRequest message for testing.
   */
  public static async generatePermissionsRequestMessage(): Promise<{ target, message: BaseMessage }> {
    const { privateJwk } = await ed25519.generateKeyPair();
    const target = 'did:jank:alice';
    const permissionRequest = await PermissionsRequest.create({
      target,
      dateCreated    : getCurrentTimeInHighPrecision(),
      description    : 'drugs',
      grantedBy      : 'did:jank:bob',
      grantedTo      : 'did:jank:alice',
      scope          : { method: 'RecordsWrite' },
      signatureInput : { privateJwk: privateJwk, protectedHeader: { alg: privateJwk.alg as string, kid: 'whatev' } }
    });

    return { target, message: permissionRequest.message };
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
    const randomString = TestDataGenerator.randomString(length);
    return new TextEncoder().encode(randomString);
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

  /**
   * Gets the method name from the given DID.
   */
  private static getDidMethodName(did: string): string {
    const segments = did.split(':', 3);
    if (segments.length < 3) {
      throw new Error(`${did} is not a valid DID`);
    }

    return segments[1];
  }

  /**
   * Generates requester and target personas if not given.
   * If `requester` and `target` are both not given, use the same persona to pass authorization in tests by default.
   */
  private static async generateRequesterAndTargetPersonas(
    input?: { requester?: Persona, target?: Persona }
  ): Promise<{ requester: Persona, target: Persona }> {
    // generate requester & target persona if not given
    let requester = input?.requester ?? await TestDataGenerator.generatePersona();
    const target = input?.target ?? await TestDataGenerator.generatePersona();

    // if `requester` and `target` are both not given, use the same persona to pass authorization in tests by default
    if (input?.requester === undefined &&
      input?.target === undefined) {
      requester = target;
    }

    return { requester, target };
  }
}