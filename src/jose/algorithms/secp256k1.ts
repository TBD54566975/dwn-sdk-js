import * as secp256k1 from '@noble/secp256k1';

import { base64url } from 'multiformats/bases/base64';
import { sha256 } from 'multiformats/hashes/sha2';

import type { PublicSecp256k1Jwk, PrivateSecp256k1Jwk, Signfn, VerifyFn } from '../types';

/**
 * generates a random keypair
 * @returns the public and private keys as JWKs
 */
export async function generateKeyPair(): Promise<{publicJwk: PublicSecp256k1Jwk, privateJwk: PrivateSecp256k1Jwk}> {
  const privateKeyBytes = secp256k1.utils.randomPrivateKey();
  // the public key is uncompressed which means that it contains both the x and y values.
  // the first byte is a header that indicates whether the key is uncompressed (0x04 if uncompressed).
  // bytes 1 - 32 represent X
  // bytes 33 - 64 represent Y
  const publicKeyBytes = await secp256k1.getPublicKey(privateKeyBytes);

  const d = base64url.baseEncode(privateKeyBytes);
  // skip the first byte because it's used as a header to indicate whether the key is uncompressed
  const x = base64url.baseEncode(publicKeyBytes.subarray(1, 33));
  const y = base64url.baseEncode(publicKeyBytes.subarray(33, 65));

  const publicJwk: PublicSecp256k1Jwk = {
    alg : 'ES256K',
    kty : 'EC',
    crv : 'secp256k1',
    x,
    y
  };
  const privateJwk: PrivateSecp256k1Jwk = { ...publicJwk, d };

  return { publicJwk, privateJwk };
}

/**
 * hashes (using sha256) and then signs the provided payload using the provided JWK
 * @param content - the content to sign
 * @param privateJwk - the key to sign with
 * @returns the signed content (aka signature)
 */
export const sign: Signfn = async (content: Uint8Array, privateJwk: PrivateSecp256k1Jwk): Promise<Uint8Array> => {
  // the underlying lib expects us to hash the content ourselves:
  // https://github.com/paulmillr/noble-secp256k1/blob/97aa518b9c12563544ea87eba471b32ecf179916/index.ts#L1160
  const hashedContent = await sha256.encode(content);
  const privateKeyBytes = base64url.baseDecode(privateJwk.d);

  return await secp256k1.sign(hashedContent, privateKeyBytes);
};

/**
 * Verifies a signature against the provided payload hash and public key.
 * @param content - the content to verify with
 * @param signature - the signature to verify against
 * @param publicJwk - the key to verify with
 * @returns a boolean indicating whether the signature matches
 */
export const verify: VerifyFn = async (content: Uint8Array, signature: Uint8Array, publicJwk: PublicSecp256k1Jwk): Promise<boolean> => {
  const xBytes = base64url.baseDecode(publicJwk.x);
  const yBytes = base64url.baseDecode(publicJwk.y);

  const publicKeyBytes = new Uint8Array(xBytes.length + yBytes.length + 1);

  // create an uncompressed public key using the x and y values from the provided JWK.
  // a leading byte of 0x04 indicates that the public key is uncompressed
  // (e.g. x and y values are both present)
  publicKeyBytes.set([0x04], 0);
  publicKeyBytes.set(xBytes, 1);
  publicKeyBytes.set(yBytes, xBytes.length + 1);

  const hashedContent = await sha256.encode(content);

  return secp256k1.verify(signature, hashedContent, publicKeyBytes);
};