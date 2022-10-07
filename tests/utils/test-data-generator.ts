import { BaseMessage } from '../../src/core/types';
import { CID } from 'multiformats/cid';
import {
  CollectionsQuery,
  CollectionsQueryMessage,
  CollectionsWrite,
  CollectionsWriteMessage,
  HandlersWrite,
  HandlersWriteMessage,
  ProtocolDefinition,
  ProtocolsConfigure,
  ProtocolsConfigureMessage,
  ProtocolsConfigureOptions,
  ProtocolsQuery,
  ProtocolsQueryMessage,
  ProtocolsQueryOptions
} from '../../src';
import { ed25519 } from '../../src/jose/algorithms/signing/ed25519';
import { DIDResolutionResult } from '../../src/did/did-resolver';
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
  targetDid?: string;
  recipientDid?: string;
  requesterDid?: string;
  requesterKeyId?: string;
  requesterKeyPair?: { publicJwk: PublicJwk, privateJwk: PrivateJwk };
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
  message: CollectionsWriteMessage;
  messageCid: CID;
  data: Uint8Array;
  /**
   * method name without the `did:` prefix. e.g. "ion"
   */
  requesterDidMethod: string;
  requesterDid: string;
  requesterKeyId: string;
  requesterKeyPair: { publicJwk: PublicJwk, privateJwk: PrivateJwk };
};

export type GenerateCollectionsQueryMessageInput = {
  targetDid?: string;
  requesterDid?: string;
  requesterKeyId?: string;
  requesterKeyPair?: { publicJwk: PublicJwk, privateJwk: PrivateJwk };
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
  message: CollectionsQueryMessage;
  /**
   * method name without the `did:` prefix. e.g. "ion"
   */
  requesterDidMethod: string;
  requesterDid: string;
  requesterKeyId: string;
  requesterKeyPair: { publicJwk: PublicJwk, privateJwk: PrivateJwk };
};

export type GenerateHandlersWriteMessageInput = {
  targetDid?: string;
  requesterDid?: string;
  requesterKeyId?: string;
  requesterKeyPair?: { publicJwk: PublicJwk, privateJwk: PrivateJwk };
  filter?: {
    method: string;
  }
  uri?: string;
};

export type GenerateHandlersWriteMessageOutput = {
  message: HandlersWriteMessage;
  requesterDidMethod: string;
  requesterDid: string;
  requesterKeyId: string;
  requesterKeyPair: { publicJwk: PublicJwk, privateJwk: PrivateJwk };
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
    // generate requester persona if not given
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
      target   : target.did,
      protocol : input?.protocol ?? TestDataGenerator.randomString(20),
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
   * if `requesterDid` and `targetDid` are not given, the generator will use the same DID for both to pass authorization in tests by default.
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
      target : target.did,
      filter : input?.filter,
      signatureInput
    };
    removeUndefinedProperties(options);

    const message = await ProtocolsQuery.create(options);

    return {
      requester,
      target,
      message,
    };
  };

  /**
   * Generates a CollectionsWrite message for testing.
   * Optional parameters are generated if not given.
   * Implementation currently uses `CollectionsWrite.create()`.
   */
  public static async generateCollectionsWriteMessage(input?: GenerateCollectionsWriteMessageInput): Promise<GenerateCollectionsWriteMessageOutput> {
    // generate requester DID if not given
    let requesterDid = input?.requesterDid;
    if (!requesterDid) {
      const didSuffix = TestDataGenerator.randomString(32);
      requesterDid = `did:example:${didSuffix}`;
    }
    const requesterDidMethod = TestDataGenerator.getDidMethodName(requesterDid);

    // generate requester key ID if not given
    const requesterKeyId = input?.requesterKeyId ?? `${requesterDid}#key1`;

    // generate requester key pair if not given
    let requesterKeyPair = input?.requesterKeyPair;
    if (!requesterKeyPair) {
      requesterKeyPair = await secp256k1.generateKeyPair();
    }

    const signatureInput = {
      jwkPrivate      : requesterKeyPair.privateJwk,
      protectedHeader : {
        alg : requesterKeyPair.privateJwk.alg!,
        kid : requesterKeyId
      }
    };

    // generate target DID if not given
    let targetDid = input?.targetDid;
    if (!targetDid) {
      // if `requesterDid` and `targetDid` are both not given in input,
      // use the same DID as the `requesterDid` to pass authorization in tests by default.
      if (!input?.requesterDid) {
        targetDid = requesterDid;
      } else {
        const didSuffix = TestDataGenerator.randomString(32);
        targetDid = `did:example:${didSuffix}`;
      }
    }

    const data = input?.data ?? TestDataGenerator.randomBytes(32);

    const options = {
      target      : targetDid,
      recipient   : input?.recipientDid ?? targetDid, // use target if recipient is not explicitly set
      nonce       : TestDataGenerator.randomString(32),
      protocol    : input?.protocol,
      contextId   : input?.contextId,
      schema      : input?.schema ?? TestDataGenerator.randomString(20),
      recordId    : input?.recordId ?? uuidv4(),
      parentId    : input?.parentId,
      published   : input?.published,
      dataFormat  : input?.dataFormat ?? 'application/json',
      dateCreated : input?.dateCreated ?? Date.now(),
      data,
      signatureInput
    };

    const collectionsWrite = await CollectionsWrite.create(options);
    const message = collectionsWrite.toObject() as CollectionsWriteMessage;
    const messageCid = await CollectionsWrite.getCid(message);

    return {
      message,
      messageCid,
      data,
      requesterDid,
      requesterDidMethod,
      requesterKeyId,
      requesterKeyPair
    };
  };

  /**
   * Generates a CollectionsQuery message for testing.
   * if `requesterDid` and `targetDid` are not given, the generator will use the same DID for both to pass authorization in tests by default.
   */
  public static async generateCollectionsQueryMessage(input?: GenerateCollectionsQueryMessageInput): Promise<GenerateCollectionsQueryMessageOutput> {
    // generate requester DID if not given
    let requesterDid = input?.requesterDid;
    if (!requesterDid) {
      const didSuffix = TestDataGenerator.randomString(32);
      requesterDid = `did:example:${didSuffix}`;
    }
    const requesterDidMethod = TestDataGenerator.getDidMethodName(requesterDid);

    // generate requester key ID if not given
    const requesterKeyId = input?.requesterKeyId ?? `${requesterDid}#key1`;

    // generate requester key pair if not given
    let requesterKeyPair = input?.requesterKeyPair;
    if (!requesterKeyPair) {
      requesterKeyPair = await secp256k1.generateKeyPair();
    }

    const signatureInput = {
      jwkPrivate      : requesterKeyPair.privateJwk,
      protectedHeader : {
        alg : requesterKeyPair.privateJwk.alg!,
        kid : requesterKeyId
      }
    };

    // generate target DID if not given
    let targetDid = input?.targetDid;
    if (!targetDid) {
      // if `requesterDid` and `targetDid` are both not given in input,
      // use the same DID as the `requesterDid` to pass authorization in tests by default.
      if (!input?.requesterDid) {
        targetDid = requesterDid;
      } else {
        const didSuffix = TestDataGenerator.randomString(32);
        targetDid = `did:example:${didSuffix}`;
      }
    }

    const options = {
      target   : targetDid,
      nonce    : TestDataGenerator.randomString(32),
      signatureInput,
      filter   : input?.filter ?? { schema: TestDataGenerator.randomString(10) }, // must have one filter property if no filter is given
      dateSort : input?.dateSort
    };
    removeUndefinedProperties(options);

    const collectionsQuery = await CollectionsQuery.create(options);
    const message = collectionsQuery.toObject() as CollectionsQueryMessage;

    return {
      message,
      requesterDid,
      requesterDidMethod,
      requesterKeyId,
      requesterKeyPair
    };
  };

  /**
   * Generates a HandlersWrite message for testing.
   * if `requesterDid` and `targetDid` are not given, the generator will use the same DID for both to pass authorization in tests by default.
   */
  public static async generateHandlersWriteMessage(input?: GenerateHandlersWriteMessageInput): Promise<GenerateHandlersWriteMessageOutput> {
    // generate requester DID if not given
    let requesterDid = input?.requesterDid;
    if (!requesterDid) {
      const didSuffix = TestDataGenerator.randomString(32);
      requesterDid = `did:example:${didSuffix}`;
    }
    const requesterDidMethod = TestDataGenerator.getDidMethodName(requesterDid);

    // generate requester key ID if not given
    const requesterKeyId = input?.requesterKeyId ?? `${requesterDid}#key1`;

    // generate requester key pair if not given
    let requesterKeyPair = input?.requesterKeyPair;
    if (!requesterKeyPair) {
      requesterKeyPair = await secp256k1.generateKeyPair();
    }

    const signatureInput = {
      jwkPrivate      : requesterKeyPair.privateJwk,
      protectedHeader : {
        alg : requesterKeyPair.privateJwk.alg!,
        kid : requesterKeyId
      }
    };

    // generate target DID if not given
    let targetDid = input?.targetDid;
    if (!targetDid) {
      // if `requesterDid` and `targetDid` are both not given in input,
      // use the same DID as the `requesterDid` to pass authorization in tests by default.
      if (!input?.requesterDid) {
        targetDid = requesterDid;
      } else {
        const didSuffix = TestDataGenerator.randomString(32);
        targetDid = `did:example:${didSuffix}`;
      }
    }

    const options = {
      target : targetDid,
      signatureInput,
      filter : input?.filter ?? { method: 'CollectionsWrite' }, // hardcode to filter on `CollectionsWrite` if no filter is given
    };
    removeUndefinedProperties(options);

    const message = await HandlersWrite.create(options);

    return {
      message,
      requesterDid,
      requesterDidMethod,
      requesterKeyId,
      requesterKeyPair
    };
  };

  /**
   * Generates a PermissionsRequest message for testing.
   */
  public static async generatePermissionsRequestMessage(): Promise<BaseMessage> {
    const { privateJwk } = await ed25519.generateKeyPair();
    const permissionRequest = await PermissionsRequest.create({
      target         : 'did:jank:alice',
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
  public static createDidResolutionResult(did: string, keyId: string, publicJwk: PublicJwk): DIDResolutionResult {
    return {
      didResolutionMetadata : {},
      didDocument           : {
        id                 : did,
        verificationMethod : [{
          controller   : did,
          id           : keyId,
          type         : 'JsonWebKey2020',
          publicKeyJwk : publicJwk
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