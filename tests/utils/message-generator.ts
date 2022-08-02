import { CollectionsWrite } from '../../src/interfaces/collections/messages/collections-write';
import { CollectionsQuerySchema, CollectionsWriteSchema } from '../../src/interfaces/collections/types';
import { PrivateJwk, PublicJwk } from '../../src/jose/types';
import { secp256k1 } from '../../src/jose/algorithms/signing/secp256k1';
import { v4 as uuidv4 } from 'uuid';
import { CollectionsQuery } from '../../src/interfaces/collections/messages/collections-query';

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
 * Utility class for generating messages for testing.
 */
export class MessageGenerator {
  /**
   * Generates a CollectionsWrite message for testing.
   * Implementation currently uses `CollectionsWrite.create()`.
   */
  public static async generateCollectionWriteMessage(): Promise<GenerateCollectionWriteMessageOutput> {
    const didMethod = MessageGenerator.randomString(10);
    const didSuffix = MessageGenerator.randomString(32);
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
      dataCid     : MessageGenerator.randomString(32),
      dataFormat  : 'application/json',
      dateCreated : Date.now(),
      nonce       : MessageGenerator.randomString(32),
      recordId    : uuidv4(),
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
    const didMethod = MessageGenerator.randomString(10);
    const didSuffix = MessageGenerator.randomString(32);
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
      nonce: MessageGenerator.randomString(32),
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

  private static randomString(length: number): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    // pick characters randomly
    let randomString = '';
    for (let i = 0; i < length; i++) {
      randomString += charset.charAt(Math.floor(Math.random() * charset.length));
    }

    return randomString;
  };
}