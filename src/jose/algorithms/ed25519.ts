import * as ed25519 from '@noble/ed25519';
import { base64url } from 'multiformats/bases/base64';

import type { PrivateEd25519Jwk, PublicEd25519Jwk, Signfn, VerifyFn  } from '../types';

/**
 * Generates ED25519 public-private key pair.
 * @returns Public and private ED25519 keys in JWK format.
 */
export async function generateKeyPair (): Promise<{
  publicJwk: PublicEd25519Jwk,
  privateJwk: PrivateEd25519Jwk
}> {
  const privateKeyBytes = ed25519.utils.randomPrivateKey();
  const publicKeyBytes = await ed25519.getPublicKey(privateKeyBytes);

  const d = base64url.baseEncode(privateKeyBytes);
  const x = base64url.baseEncode(publicKeyBytes);

  const publicJwk: PublicEd25519Jwk = {
    alg : 'EdDSA',
    kty : 'OKP',
    crv : 'Ed25519',
    x
  };
  const privateJwk: PrivateEd25519Jwk = { ...publicJwk, d };

  return { publicJwk, privateJwk };
}

/**
 * signs the provided payload using the provided JWK
 * @param content - the content to sign
 * @param privateJwk - the key to sign with
 * @returns the signed content (aka signature)
 */
export const sign: Signfn = (
  content: Uint8Array,
  privateJwk: PrivateEd25519Jwk
): Promise<Uint8Array> => {
  const privateKeyBytes = base64url.baseDecode(privateJwk.d);

  return ed25519.sign(content, privateKeyBytes);
};

/**
 * Verifies a signature against the provided payload hash and public key.
 * @param content - the content to verify with
 * @param signature - the signature to verify against
 * @param publicJwk - the key to verify with
 * @returns a boolean indicating whether the signature matches
 */
export const verify: VerifyFn = (content: Uint8Array, signature: Uint8Array, publicJwk: PublicEd25519Jwk): Promise<boolean> => {
  const publicKeyBytes = base64url.baseDecode(publicJwk.x);

  return ed25519.verify(signature, content, publicKeyBytes);
};