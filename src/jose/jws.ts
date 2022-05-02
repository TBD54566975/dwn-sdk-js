import * as ed25519 from './algorithms/ed25519';
import * as secp256k1 from './algorithms/secp256k1';
import base64url from 'base64url';
import type { JwkPrivate, JwkPublic } from './jwk';

/**
 * A JWS in flattened JWS JSON format.
 */
export type JwsFlattened = {
  protected: string,
  payload: string,
  signature: string
};

/**
 * Signs the given payload as a JWS.
 * NOTE: this is mainly used by tests to create valid test data.
 * @throws {Error} if key given is unsupported.
 */
export async function sign (
  protectedHeader: object,
  payload: Buffer,
  privateKeyJwk: JwkPrivate
): Promise<JwsFlattened> {
  const protectedHeaderString = JSON.stringify(protectedHeader);
  const protectedHeaderBase64UrlString = base64url.encode(protectedHeaderString);
  const payloadBase64UrlString = base64url.encode(payload);
  const signingInputBase64urlString = protectedHeaderBase64UrlString + '.' + payloadBase64UrlString;
  const signingInputBuffer = Buffer.from(signingInputBase64urlString);

  // This is where we will add support for different algorithms over time.
  let dsaSign: (signingInputBuffer: Buffer, privateKeyJwk: JwkPrivate) => Promise<Buffer>;
  if (privateKeyJwk.crv === 'Ed25519') {
    dsaSign = ed25519.sign;
  } else if (privateKeyJwk.crv === 'secp256k1') {
    dsaSign = secp256k1.sign;
  } else {
    throw new Error(`unsupported key type ${privateKeyJwk.kty} with curve ${privateKeyJwk.crv}`);
  }

  const signatureBuffer = await dsaSign(signingInputBuffer, privateKeyJwk);
  const signatureBase64UrlString = base64url.encode(signatureBuffer);

  return {
    payload   : payloadBase64UrlString,
    protected : protectedHeaderBase64UrlString,
    signature : signatureBase64UrlString
  };
}

/**
 * Verifies the JWS signature.
 * @returns `true` if signature is successfully verified, false otherwise.
 * @throws {Error} if key given is unsupported.
 */
export async function verify (
  jwsFlattenedModel: JwsFlattened,
  publicKeyJwk: JwkPublic
): Promise<boolean> {
  const signatureInput = jwsFlattenedModel.protected + '.' + jwsFlattenedModel.payload;
  const signatureInputBuffer = Buffer.from(signatureInput);
  const signatureBuffer = base64url.toBuffer(jwsFlattenedModel.signature);

  // This is where we will add support for different algorithms over time.
  let dsaVerify: (signingInputBuffer: Buffer, signatureBuffer: Buffer, jwkPublic: JwkPublic) => Promise<boolean>;
  if (publicKeyJwk.crv === 'Ed25519') {
    dsaVerify = ed25519.verify;
  } else if (publicKeyJwk.crv === 'secp256k1') {
    dsaVerify = secp256k1.verify;
  } else {
    throw new Error(`unsupported key type ${publicKeyJwk.kty} with curve ${publicKeyJwk.crv}`);
  }

  const result = await dsaVerify(signatureInputBuffer, signatureBuffer, publicKeyJwk);
  return result;
}
