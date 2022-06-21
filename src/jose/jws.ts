import * as ed25519 from './algorithms/ed25519';
import * as secp256k1 from './algorithms/secp256k1';

import { base64url } from 'multiformats/bases/base64';

import type { JwkPrivate, JwkPublic } from './jwk';

export type Signer = (payload: Uint8Array, privateKeyJwk: JwkPrivate) => Promise<Uint8Array>;
export type Verifier = (payload: Uint8Array, signature: Uint8Array, publicKeyJwk: JwkPublic) => Promise<boolean>;

const verifiers: { [key:string]: Verifier } = {
  'Ed25519'   : ed25519.verify,
  'secp256k1' : secp256k1.verify
};

const signers: { [key:string]: Signer } = {
  'Ed25519'   : ed25519.sign,
  'secp256k1' : secp256k1.sign
};

/**
 * Signs the given payload and header as a JWS.
 * @throws {Error} if the provided key is unsupported.
 */
export async function sign(payload: Uint8Array, jwkPrivate: JwkPrivate): Promise<string> {
  const signFn: Signer = signers[jwkPrivate.crv];

  if (!signFn) {
    throw new Error(`unsupported crv. crv must be one of ${Object.keys(signers)}`);
  }

  const protectedHeaderString = JSON.stringify({ kid: jwkPrivate.kid, alg: jwkPrivate.alg });
  const protectedHeaderBytes = new TextEncoder().encode(protectedHeaderString);
  const protectedHeaderBase64UrlString = base64url.baseEncode(protectedHeaderBytes);

  const payloadBase64UrlString = base64url.baseEncode(payload);
  const signingInputBase64urlString = `${protectedHeaderBase64UrlString}.${payloadBase64UrlString}`;
  const signingInputBytes = new TextEncoder().encode(signingInputBase64urlString);

  const signatureBytes = await signFn(signingInputBytes, jwkPrivate);
  const signatureBase64UrlString = base64url.baseEncode(signatureBytes);

  return `${protectedHeaderBase64UrlString}.${payloadBase64UrlString}.${signatureBase64UrlString}`;
}

/**
 * Verifies that the provided JWS was signed using the private key of the provided public key.
 * @returns `true` if signature is successfully verified, false otherwise.
 * @throws {Error} if key given is unsupported.
 */
export async function verify(jwsCompact: string, jwkPublic: JwkPublic): Promise<boolean> {
  const verifyFn: Verifier = verifiers[jwkPublic.crv];

  if (!verifyFn) {
    throw new Error(`unsupported crv. crv must be one of ${Object.keys(verifiers)}`);
  }

  const [protectedHeader, payload, signature] = jwsCompact.split('.');

  const payloadBytes = new TextEncoder().encode(`${protectedHeader}.${payload}`);
  const signatureBytes = base64url.baseDecode(signature);

  return await verifyFn(payloadBytes, signatureBytes, jwkPublic);
}