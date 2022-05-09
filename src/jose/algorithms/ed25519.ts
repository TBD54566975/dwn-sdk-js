import * as ed25519 from '@noble/ed25519';
import { base64url } from 'multiformats/bases/base64';

/**
 * An Ed25519 public key in JWK format.
 */
export type JwkEd25519Public = {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
};

/**
 * An Ed25519 private key in JWK format.
 */
export type JwkEd25519Private = JwkEd25519Public & {
  d: string; // Only used by a private key
};


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

  const publicKeyJwk: JwkEd25519Public = { kty: 'OKP', crv: 'Ed25519', x };
  const privateKeyJwk: Required<JwkEd25519Private> = { ...publicKeyJwk, d };

  return { publicKeyJwk, privateKeyJwk };
}

/**
 * signs the provided payload using the provided JWK
 * @param payload - the content to sign
 * @param privateKeyJwk - the key to sign with
 * @returns the signed payload (aka signature)
 */
export async function sign (
  payload: Uint8Array,
  privateKeyJwk: JwkEd25519Private
): Promise<Uint8Array> {
  const privateKeyBytes = base64url.baseDecode(privateKeyJwk.d);

  return await ed25519.sign(payload, privateKeyBytes);
}

/**
 * Verifies a signature against the provided payload hash and public key.
 * @param payload - the content to verify with
 * @param signature - the signature to verify against
 * @param publicKeyJwk - the key to verify with
 * @returns a boolean indicating whether the signature matches
 */
export async function verify (payload: Uint8Array, signature: Uint8Array, publicKeyJwk: JwkEd25519Public): Promise<boolean> {
  const publicKeyBytes = base64url.baseDecode(publicKeyJwk.x);

  return await ed25519.verify(signature, payload, publicKeyBytes);
}