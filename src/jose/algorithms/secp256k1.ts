import type { Jwk } from '../types';

import * as secp256k1 from '@noble/secp256k1';

import { base64url } from 'multiformats/bases/base64';
import { sha256 } from 'multiformats/hashes/sha2';

/**
 * A SECP256K1 public key in JWK format.
 * Values taken from:
 * https://www.iana.org/assignments/jose/jose.xhtml#web-key-elliptic-curve
 * https://datatracker.ietf.org/doc/html/draft-ietf-cose-webauthn-algorithms-06#section-3.1
 */
export type JwkSecp256k1Public = Jwk & {
  alg: 'ES256K';
  crv: 'secp256k1';
  kid: string;
  kty: 'EC';
  use: 'sig';
  x: string;
  y: string;
};

/**
 * A SECP256K1 private key in JWK format.
 */
export type JwkSecp256k1Private = JwkSecp256k1Public & {
  d: string; // Only used by a private key.
};

/**
 * generates a random keypair
 * @returns the public and private keys as JWKs
 */
export async function generateKeyPair(kid: string): Promise<{publicKeyJwk: JwkSecp256k1Public, privateKeyJwk: JwkSecp256k1Private}> {
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

  const publicKeyJwk: JwkSecp256k1Public = {
    alg : 'ES256K',
    kid,
    kty : 'EC',
    use : 'sig',
    crv : 'secp256k1',
    x,
    y
  };
  const privateKeyJwk: Required<JwkSecp256k1Private> = { ...publicKeyJwk, d };

  return { publicKeyJwk, privateKeyJwk };
}

/**
 * hashes (using sha256) and then signs the provided payload using the provided JWK
 * @param content - the content to sign
 * @param privateKeyJwk - the key to sign with
 * @returns the signed content (aka signature)
 */
export async function sign(content: Uint8Array, privateKeyJwk: JwkSecp256k1Private): Promise<Uint8Array> {
  // the underlying lib expects us to hash the content ourselves:
  // https://github.com/paulmillr/noble-secp256k1/blob/97aa518b9c12563544ea87eba471b32ecf179916/index.ts#L1160
  const hashedContent = await sha256.encode(content);
  const privateKeyBytes = base64url.baseDecode(privateKeyJwk.d);

  return await secp256k1.sign(hashedContent, privateKeyBytes);
}

/**
 * Verifies a signature against the provided payload hash and public key.
 * @param content - the content to verify with
 * @param signature - the signature to verify against
 * @param publicKeyJwk - the key to verify with
 * @returns a boolean indicating whether the signature matches
 */
export async function verify(content: Uint8Array, signature: Uint8Array, publicKeyJwk: JwkSecp256k1Public): Promise<boolean> {
  const xBytes = base64url.baseDecode(publicKeyJwk.x);
  const yBytes = base64url.baseDecode(publicKeyJwk.y);

  const publicKeyBytes = new Uint8Array(xBytes.length + yBytes.length + 1);

  // create an uncompressed public key using the x and y values from the provided JWK.
  // a leading byte of 0x04 indicates that the public key is uncompressed
  // (e.g. x and y values are both present)
  publicKeyBytes.set([0x04], 0);
  publicKeyBytes.set(xBytes, 1);
  publicKeyBytes.set(yBytes, xBytes.length + 1);

  const hashedContent = await sha256.encode(content);

  return secp256k1.verify(signature, hashedContent, publicKeyBytes);
}