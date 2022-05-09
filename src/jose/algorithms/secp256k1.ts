import * as secp256k1 from '@noble/secp256k1';

import { base64url } from 'multiformats/bases/base64';
import { sha256 } from 'multiformats/hashes/sha2';

/**
 * A SECP256K1 public key in JWK format.
 * Values taken from:
 * https://www.iana.org/assignments/jose/jose.xhtml#web-key-elliptic-curve
 * https://datatracker.ietf.org/doc/html/draft-ietf-cose-webauthn-algorithms-06#section-3.1
 */
export type JwkSecp256k1Public = {
  kty: 'EC';
  crv: 'secp256k1';
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
export async function generateKeyPair(): Promise<{
  publicKeyJwk: JwkSecp256k1Public,
  privateKeyJwk: JwkSecp256k1Private
}> {
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

  const publicKeyJwk: JwkSecp256k1Public = { kty: 'EC', crv: 'secp256k1', x, y };
  const privateKeyJwk: Required<JwkSecp256k1Private> = { ...publicKeyJwk, d };

  return { publicKeyJwk, privateKeyJwk };
}

/**
 * hashes (using sha256) and then signs the provided payload using the provided JWK
 * @param payload - the content to sign
 * @param privateKeyJwk - the key to sign with
 * @returns the signed payload (aka signature)
 */
export async function sign(payload: Uint8Array, privateKeyJwk: JwkSecp256k1Private): Promise<Uint8Array> {
  // the underlying lib expects us to hash the payload ourselves:
  // https://github.com/paulmillr/noble-secp256k1/blob/97aa518b9c12563544ea87eba471b32ecf179916/index.ts#L1160
  const hashedPayload = await sha256.encode(payload);
  const privateKeyBytes = base64url.baseDecode(privateKeyJwk.d);

  return await secp256k1.sign(hashedPayload, privateKeyBytes);
}

/**
 * Verifies a signature against the provided payload hash and public key.
 * @param payload - the content to verify with
 * @param signature - the signature to verify against
 * @param publicKeyJwk - the key to verify with
 * @returns a boolean indicating whether the signature matches
 */
export async function verify(payload: Uint8Array, signature: Uint8Array, publicKeyJwk: JwkSecp256k1Public): Promise<boolean> {
  const publicKey = secp256k1.Point.fromHex(publicKeyJwk.x);

  return secp256k1.verify(signature, payload, publicKey);
}