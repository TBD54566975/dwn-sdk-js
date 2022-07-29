import { CollectionsWrite } from '../../src/interfaces/collections/messages/collections-write';
import { CollectionsWriteSchema } from '../../src/interfaces/collections/types';
import { PrivateJwk, PublicJwk } from '../../src/jose/types';
import { secp256k1 } from '../../src/jose/algorithms/signing/secp256k1';
import { v4 as uuidv4 } from 'uuid';

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

/**
 * Generates a CollectionsWrite message for testing.
 * Implementation currently uses `CollectionsWrite.create()`.
 */
export const generateCollectionWriteMessage = async (): Promise<GenerateCollectionWriteMessageOutput> => {
  const didMethod = randomString(10);
  const didSuffix = randomString(32);
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
    dataCid     : randomString(32),
    dataFormat  : 'application/json',
    dateCreated : Date.now(),
    nonce       : randomString(32),
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

const randomString = (length: number): string => {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  // pick characters randomly
  let str = '';
  for (let i = 0; i < length; i++) {
    str += charset.charAt(Math.floor(Math.random() * charset.length));
  }

  return str;

};