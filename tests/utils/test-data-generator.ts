import * as cbor from '@ipld/dag-cbor';
import { BaseMessage } from '../../src/core/types.js';
import { CID } from 'multiformats/cid';
import { DidResolutionResult } from '../../src/did/did-resolver.js';
import { ed25519 } from '../../src/jose/algorithms/signing/ed25519.js';
import { getCurrentTimeInHighPrecision } from '../../src/utils/time.js';
import { PermissionsRequest } from '../../src/interfaces/permissions/messages/permissions-request.js';
import { removeUndefinedProperties } from '../../src/utils/object.js';
import { secp256k1 } from '../../src/jose/algorithms/signing/secp256k1.js';
import { sha256 } from 'multiformats/hashes/sha2';
import { SignatureInput } from '../../src/jose/jws/general/types.js';
import {
  CollectionsQuery,
  CollectionsQueryMessage,
  CollectionsQueryOptions,
  CollectionsWrite,
  CollectionsWriteMessage,
  CollectionsWriteOptions,
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
  ProtocolsQueryOptions
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

export type GenerateCollectionsWriteMessageInput = {
  requester?: Persona;
  target?: Persona;
  recipientDid?: string;
  protocol?: string;
  contextId?: string;
  schema?: string;
  recordId?: string;
  lineageParent?: string;
  parentId?: string;
  published?: boolean;
  data?: Uint8Array;
  dataFormat?: string;
  dateCreated? : string;
  datePublished? : string;
};

export type GenerateCollectionsWriteMessageOutput = {
  requester: Persona;
  target: Persona;
  message: CollectionsWriteMessage;
  collectionsWrite: CollectionsWrite;
};

export type GenerateCollectionsQueryMessageInput = {
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

export type GenerateCollectionsQueryMessageOutput = {
  requester: Persona;
  target: Persona;
  message: CollectionsQueryMessage;
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
        labels  : { },
        records : { }
      };
      definition.labels[generatedLabel] = { schema: `test-object` };
      definition.records[generatedLabel] = { };
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
   * Generates a CollectionsWrite message for testing.
   * Optional parameters are generated if not given.
   * If `requester` and `target` are both not given, use the same persona to pass authorization in tests by default.
   * Implementation currently uses `CollectionsWrite.create()`.
   */
  public static async generateCollectionsWriteMessage(input?: GenerateCollectionsWriteMessageInput): Promise<GenerateCollectionsWriteMessageOutput> {

    const { requester, target } = await TestDataGenerator.generateRequesterAndTargetPersonas(input);

    const signatureInput = TestDataGenerator.createSignatureInputFromPersona(requester);

    const data = input?.data ?? TestDataGenerator.randomBytes(32);

    const options: CollectionsWriteOptions = {
      target        : target.did,
      recipient     : input?.recipientDid ?? target.did, // use target if recipient is not explicitly set
      protocol      : input?.protocol,
      contextId     : input?.contextId,
      schema        : input?.schema ?? TestDataGenerator.randomString(20),
      recordId      : input?.recordId,
      lineageParent : input?.lineageParent,
      parentId      : input?.parentId,
      published     : input?.published,
      dataFormat    : input?.dataFormat ?? 'application/json',
      dateCreated   : input?.dateCreated,
      datePublished : input?.datePublished,
      data,
      signatureInput
    };


    const collectionsWrite = await CollectionsWrite.create(options);
    const message = collectionsWrite.message as CollectionsWriteMessage;

    return {
      target,
      requester,
      message,
      collectionsWrite
    };
  };

  /**
   * Generates a CollectionsQuery message for testing.
   */
  public static async generateCollectionsQueryMessage(input?: GenerateCollectionsQueryMessageInput): Promise<GenerateCollectionsQueryMessageOutput> {
    const { requester, target } = await TestDataGenerator.generateRequesterAndTargetPersonas(input);

    const signatureInput = TestDataGenerator.createSignatureInputFromPersona(requester);

    const options: CollectionsQueryOptions = {
      target      : target.did,
      dateCreated : input?.dateCreated,
      signatureInput,
      filter      : input?.filter ?? { schema: TestDataGenerator.randomString(10) }, // must have one filter property if no filter is given
      dateSort    : input?.dateSort
    };
    removeUndefinedProperties(options);

    const collectionsQuery = await CollectionsQuery.create(options);
    const message = collectionsQuery.message as CollectionsQueryMessage;

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
      filter      : input?.filter ?? { method: 'CollectionsWrite' }, // hardcode to filter on `CollectionsWrite` if no filter is given
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
  public static async generatePermissionsRequestMessage(): Promise<{target, message: BaseMessage}> {
    const { privateJwk } = await ed25519.generateKeyPair();
    const target = 'did:jank:alice';
    const permissionRequest = await PermissionsRequest.create({
      target,
      dateCreated    : getCurrentTimeInHighPrecision(),
      description    : 'drugs',
      grantedBy      : 'did:jank:bob',
      grantedTo      : 'did:jank:alice',
      scope          : { method: 'CollectionsWrite' },
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
    input?: { requester?: Persona, target?: Persona}
  ): Promise<{ requester: Persona, target: Persona}> {
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