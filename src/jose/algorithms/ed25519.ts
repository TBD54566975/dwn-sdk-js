import * as ed25519 from '@noble/ed25519';
import { base64url } from 'multiformats/bases/base64';

import type { JwkEd25519Private, JwkEd25519Public, Signfn, VerifyFn  } from '../types';

/**
 * Generates ED25519 public-private key pair.
 * @returns Public and private ED25519 keys in JWK format.
 */
export async function generateKeyPair (): Promise<{
  publicKeyJwk: JwkEd25519Public,
  privateKeyJwk: JwkEd25519Private
}> {
  const privateKeyBytes = ed25519.utils.randomPrivateKey();
  const publicKeyBytes = await ed25519.getPublicKey(privateKeyBytes);

  const d = base64url.baseEncode(privateKeyBytes);
  const x = base64url.baseEncode(publicKeyBytes);

  const publicKeyJwk: JwkEd25519Public = {
    alg : 'EdDSA',
    kty : 'OKP',
    crv : 'Ed25519',
    x
  };
  const privateKeyJwk: JwkEd25519Private = { ...publicKeyJwk, d };

  return { publicKeyJwk, privateKeyJwk };
}

/**
 * signs the provided payload using the provided JWK
 * @param content - the content to sign
 * @param privateKeyJwk - the key to sign with
 * @returns the signed content (aka signature)
 */
export const sign: Signfn = (
  content: Uint8Array,
  privateKeyJwk: JwkEd25519Private
): Promise<Uint8Array> => {
  const privateKeyBytes = base64url.baseDecode(privateKeyJwk.d);

  return ed25519.sign(content, privateKeyBytes);
};

/**
 * Verifies a signature against the provided payload hash and public key.
 * @param content - the content to verify with
 * @param signature - the signature to verify against
 * @param publicKeyJwk - the key to verify with
 * @returns a boolean indicating whether the signature matches
 */
export const verify: VerifyFn = (content: Uint8Array, signature: Uint8Array, publicKeyJwk: JwkEd25519Public): Promise<boolean> => {
  const publicKeyBytes = base64url.baseDecode(publicKeyJwk.x);

  return ed25519.verify(signature, content, publicKeyBytes);
};