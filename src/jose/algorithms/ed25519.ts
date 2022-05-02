import * as ed25519 from '@noble/ed25519';
import base64url from 'base64url';

/**
 * An Ed25519 public key in JWK format.
 */
export type JwkEd25519Public = {
  kty: string;
  crv: string;
  x: string;
};

/**
 * An Ed25519 private key in JWK format.
 */
export type JwkEd25519Private = JwkEd25519Public & {
  d: string; // Only used by a private key.
};


/**
 * Generates ED25519 public-private key pair.
 * @returns Public and private ED25519 keys in JWK format.
 */
export async function generateKeyPair (): Promise<{
  publicKeyJwk: JwkEd25519Public,
  privateKeyJwk: JwkEd25519Private
}> {
  const privateKeyUint8Array = ed25519.utils.randomPrivateKey();
  const publicKeyUint8Array = await ed25519.getPublicKey(privateKeyUint8Array);
  const privateKeyBuffer = Buffer.from(privateKeyUint8Array);
  const publicKeyBuffer = Buffer.from(publicKeyUint8Array);

  const d = base64url.encode(privateKeyBuffer);
  const x = base64url.encode(publicKeyBuffer);

  const publicKeyJwk: JwkEd25519Public = {
    kty : 'OKP',
    crv : 'Ed25519',
    x
  };

  const privateKeyJwk: Required<JwkEd25519Private> = {
    ...publicKeyJwk,
    d
  };

  return { publicKeyJwk, privateKeyJwk };
}

/**
 * Implementation of signing using ED25519.
 */
export async function sign (
  signingInputBuffer: Buffer,
  privateKeyJwk: JwkEd25519Private
): Promise<Buffer> {
  const privateKeyBuffer = base64url.toBuffer(privateKeyJwk.d);
  const signatureUint8Array = await ed25519.sign(signingInputBuffer, privateKeyBuffer);
  const signatureBuffer = Buffer.from(signatureUint8Array);
  return signatureBuffer;
}

/**
 * Implementation of signature verification using ED25519.
 */
export async function verify (
  signatureInputBuffer: Buffer,
  signatureBuffer: Buffer,
  publicKeyJwk: JwkEd25519Public
): Promise<boolean> {
  const publicKeyBuffer = base64url.toBuffer(publicKeyJwk.x);
  const result = await ed25519.verify(signatureBuffer, signatureInputBuffer, publicKeyBuffer);
  return result;
}