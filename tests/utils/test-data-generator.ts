import { CollectionsWrite } from '../../src/interfaces/collections/messages/collections-write';
import { CollectionsQuery } from '../../src/interfaces/collections/messages/collections-query';
import { CollectionsQuerySchema, CollectionsWriteSchema } from '../../src/interfaces/collections/types';
import { ed25519 } from '../../src/jose/algorithms/signing/ed25519';
import { DIDResolutionResult } from '../../src/did/did-resolver';
import { PrivateJwk, PublicJwk } from '../../src/jose/types';
import { secp256k1 } from '../../src/jose/algorithms/signing/secp256k1';
import { v4 as uuidv4 } from 'uuid';
import { BaseMessageSchema } from '../../src/core/types';
import { PermissionsRequest } from '../../src/interfaces/permissions/messages/permissions-request';


type GenerateCollectionWriteMessageInput = {
  protocol?: string;
  schema?: string;
  recordId?: string;
  dataCid?: string;
  dataFormat?: string;
};

type GenerateCollectionWriteMessageOutput = {
  message: CollectionsWriteSchema;
  /**
   * method name without the `did:` prefix. e.g. "ion"
   */
  didMethod: string;
  did: string;
  keyId: string;
  keyPair: { publicJwk: PublicJwk, privateJwk: PrivateJwk };
};

type GenerateCollectionQueryMessageInput = {
  protocol?: string;
  schema?: string;
  recordId?: string;
  dataFormat?: string;
  dateSort?: string;
};

type GenerateCollectionQueryMessageOutput = {
  message: CollectionsQuerySchema;
  /**
   * method name without the `did:` prefix. e.g. "ion"
   */
  didMethod: string;
  requesterDid: string;
  requesterKeyId: string;
  requesterKeyPair: { publicJwk: PublicJwk, privateJwk: PrivateJwk };
};

/**
 * Utility class for generating data for testing.
 */
export class TestDataGenerator {
  /**
   * Generates a CollectionsWrite message for testing.
   * All optional parameters are generated if not given.
   * Implementation currently uses `CollectionsWrite.create()`.
   */
  public static async generateCollectionWriteMessage(input?: GenerateCollectionWriteMessageInput): Promise<GenerateCollectionWriteMessageOutput> {
    const didMethod = TestDataGenerator.randomString(10);
    const didSuffix = TestDataGenerator.randomString(32);
    const did = `did:${didMethod}:${didSuffix}`;
    const keyId = `${did}#key1`;
    const { privateJwk, publicJwk } = await secp256k1.generateKeyPair();

    const signatureInput = {
      jwkPrivate      : privateJwk,
      protectedHeader : {
        alg : privateJwk.alg!,
        kid : keyId
      }
    };

    const options = {
      nonce       : TestDataGenerator.randomString(32),
      protocol    : input?.protocol ? input.protocol : TestDataGenerator.randomString(10),
      schema      : input?.schema ? input.schema : TestDataGenerator.randomString(20),
      recordId    : input?.recordId ? input.recordId : uuidv4(),
      dataCid     : input?.dataCid ? input.dataCid : TestDataGenerator.randomString(32),
      dataFormat  : input?.dataFormat ? input.dataFormat : 'application/json',
      dateCreated : Date.now(),
      signatureInput
    };

    const collectionsWrite = await CollectionsWrite.create(options);
    const message = collectionsWrite.toObject() as CollectionsWriteSchema;

    return {
      message,
      didMethod,
      did,
      keyId,
      keyPair: { privateJwk, publicJwk }
    };
  };

  /**
   * Generates a CollectionsQuery message for testing.
   */
  public static async generateCollectionQueryMessage(input?: GenerateCollectionQueryMessageInput): Promise<GenerateCollectionQueryMessageOutput> {
    const didMethod = TestDataGenerator.randomString(10);
    const didSuffix = TestDataGenerator.randomString(32);
    const requesterDid = `did:${didMethod}:${didSuffix}`;
    const requesterKeyId = `${requesterDid}#key1`;
    const { privateJwk, publicJwk } = await secp256k1.generateKeyPair();

    const signatureInput = {
      jwkPrivate      : privateJwk,
      protectedHeader : {
        alg : privateJwk.alg!,
        kid : requesterKeyId
      }
    };

    const options = {
      nonce: TestDataGenerator.randomString(32),
      signatureInput,
      ...input
    };

    const collectionsQuery = await CollectionsQuery.create(options);
    const message = collectionsQuery.toObject() as CollectionsQuerySchema;

    return {
      message,
      didMethod,
      requesterDid,
      requesterKeyId,
      requesterKeyPair: { privateJwk, publicJwk }
    };
  };

  /**
   * Generates a PermissionsRequest message for testing.
   */
  public static async generatePermissionRequestMessage(): Promise<BaseMessageSchema> {
    const { privateJwk } = await ed25519.generateKeyPair();
    const permissionRequest = await PermissionsRequest.create({
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
}