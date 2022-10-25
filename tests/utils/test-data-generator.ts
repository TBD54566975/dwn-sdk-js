import { BaseMessage } from '../../src/core/types';
import {
  CollectionsQuery,
  CollectionsQueryMessage,
  CollectionsQueryOptions,
  CollectionsWrite,
  CollectionsWriteMessage,
  CollectionsWriteOptions,
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
} from '../../src';
import { ed25519 } from '../../src/jose/algorithms/signing/ed25519';
import { DidResolutionResult } from '../../src/did/did-resolver';
import { PermissionsRequest } from '../../src/interfaces/permissions/messages/permissions-request';
import { PrivateJwk, PublicJwk } from '../../src/jose/types';
import { removeUndefinedProperties } from '../../src/utils/object';
import { secp256k1 } from '../../src/jose/algorithms/signing/secp256k1';
import { v4 as uuidv4 } from 'uuid';

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
  dateCreated?: number;
  protocol?: string;
  protocolDefinition?: ProtocolDefinition;
};

export type GenerateProtocolsConfigureMessageOutput = {
  requester: Persona;
  target: Persona;
  message: ProtocolsConfigureMessage;
};

export type GenerateProtocolsQueryMessageInput = {
  requester?: Persona;
  target?: Persona;
  dateCreated?: number;
  filter?: {
    protocol: string;
  }
};

export type GenerateProtocolsQueryMessageOutput = {
  requester: Persona;
  target: Persona;
  message: ProtocolsQueryMessage;
};

export type GenerateCollectionsWriteMessageInput = {
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
  dateCreated? : number;
};

export type GenerateCollectionsWriteMessageOutput = {
  requester: Persona;
  target: Persona;
  message: CollectionsWriteMessage;
};

export type GenerateCollectionsQueryMessageInput = {
  requester?: Persona;
  target?: Persona;
  dateCreated?: number;
  filter?: {
    recipient?: string;
    protocol?: string;
    contextId?: string;
    schema?: string;
    recordId?: string;
    parentId?: string;
    dataFormat?: string;
  }
  dateSort?: string;
};

export type GenerateCollectionsQueryMessageOutput = {
  requester: Persona;
  target: Persona;
  message: CollectionsQueryMessage;
};

export type GenerateHooksWriteMessageInput = {
  requester?: Persona;
  target?: Persona;
  dateCreated?: number;
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

    const signatureInput = {
      jwkPrivate      : requester.keyPair.privateJwk,
      protectedHeader : {
        alg : requester.keyPair.privateJwk.alg!,
        kid : requester.keyId
      }
    };

    const options: ProtocolsConfigureOptions = {
      target      : target.did,
      dateCreated : input?.dateCreated,
      protocol    : input?.protocol ?? TestDataGenerator.randomString(20),
      definition,
      signatureInput
    };

    const message = await ProtocolsConfigure.create(options);

    return {
      requester,
      target,
      message
    };
  };

  /**
   * Generates a ProtocolsQuery message for testing.
   */
  public static async generateProtocolsQueryMessage(input?: GenerateProtocolsQueryMessageInput): Promise<GenerateProtocolsQueryMessageOutput> {
    // generate requester persona if not given
    const { requester, target } = await TestDataGenerator.generateRequesterAndTargetPersonas(input);

    const signatureInput = {
      jwkPrivate      : requester.keyPair.privateJwk,
      protectedHeader : {
        alg : requester.keyPair.privateJwk.alg!,
        kid : requester.keyId
      }
    };

    const options: ProtocolsQueryOptions = {
      target      : target.did,
      dateCreated : input?.dateCreated,
      filter      : input?.filter,
      signatureInput
    };
    removeUndefinedProperties(options);

    const message = await ProtocolsQuery.create(options);

    return {
      requester,
      target,
      message
    };
  };

  /**
   * Generates a CollectionsWrite message for testing.
   * Optional parameters are generated if not given.
   * Implementation currently uses `CollectionsWrite.create()`.
   */
  public static async generateCollectionsWriteMessage(input?: GenerateCollectionsWriteMessageInput): Promise<GenerateCollectionsWriteMessageOutput> {

    const { requester, target } = await TestDataGenerator.generateRequesterAndTargetPersonas(input);

    const signatureInput = {
      jwkPrivate      : requester.keyPair.privateJwk,
      protectedHeader : {
        alg : requester.keyPair.privateJwk.alg!,
        kid : requester.keyId
      }
    };

    const data = input?.data ?? TestDataGenerator.randomBytes(32);

    const options: CollectionsWriteOptions = {
      target      : target.did,
      recipient   : input?.recipientDid ?? target.did, // use target if recipient is not explicitly set
      protocol    : input?.protocol,
      contextId   : input?.contextId,
      schema      : input?.schema ?? TestDataGenerator.randomString(20),
      recordId    : input?.recordId ?? uuidv4(),
      parentId    : input?.parentId,
      published   : input?.published,
      dataFormat  : input?.dataFormat ?? 'application/json',
      dateCreated : input?.dateCreated,
      data,
      signatureInput
    };


    const collectionsWrite = await CollectionsWrite.create(options);
    const message = collectionsWrite.toObject() as CollectionsWriteMessage;

    return {
      target,
      requester,
      message
    };
  };

  /**
   * Generates a CollectionsQuery message for testing.

   */
  public static async generateCollectionsQueryMessage(input?: GenerateCollectionsQueryMessageInput): Promise<GenerateCollectionsQueryMessageOutput> {
    const { requester, target } = await TestDataGenerator.generateRequesterAndTargetPersonas(input);

    const signatureInput = {
      jwkPrivate      : requester.keyPair.privateJwk,
      protectedHeader : {
        alg : requester.keyPair.privateJwk.alg!,
        kid : requester.keyId
      }
    };


    const options: CollectionsQueryOptions = {
      target      : target.did,
      dateCreated : input?.dateCreated,
      signatureInput,
      filter      : input?.filter ?? { schema: TestDataGenerator.randomString(10) }, // must have one filter property if no filter is given
      dateSort    : input?.dateSort
    };
    removeUndefinedProperties(options);

    const collectionsQuery = await CollectionsQuery.create(options);
    const message = collectionsQuery.toObject() as CollectionsQueryMessage;

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

    const signatureInput = {
      jwkPrivate      : requester.keyPair.privateJwk,
      protectedHeader : {
        alg : requester.keyPair.privateJwk.alg!,
        kid : requester.keyId
      }
    };

    const options: HooksWriteOptions = {
      target      : target.did,
      dateCreated : input?.dateCreated,
      signatureInput,
      filter      : input?.filter ?? { method: 'CollectionsWrite' }, // hardcode to filter on `CollectionsWrite` if no filter is given
    };
    removeUndefinedProperties(options);

    const message = await HooksWrite.create(options);

    return {
      target,
      requester,
      message
    };
  };

  /**
   * Generates a PermissionsRequest message for testing.
   */
  public static async generatePermissionsRequestMessage(): Promise<BaseMessage> {
    const { privateJwk } = await ed25519.generateKeyPair();
    const permissionRequest = await PermissionsRequest.create({
      target         : 'did:jank:alice',
      dateCreated    : Date.now(),
      description    : 'drugs',
      grantedBy      : 'did:jank:bob',
      grantedTo      : 'did:jank:alice',
      scope          : { method: 'CollectionsWrite' },
      signatureInput : { jwkPrivate: privateJwk, protectedHeader: { alg: privateJwk.alg as string, kid: 'whatev' } }
    });

    return permissionRequest.toObject();
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
   * Generates a random byte array of given length
   */
  public static randomBytes(length: number): Uint8Array {
    const randomString = TestDataGenerator.randomString(length);
    return new TextEncoder().encode(randomString);
  };

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