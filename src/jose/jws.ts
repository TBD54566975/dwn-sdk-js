import * as ed25519 from './algorithms/ed25519';
import * as jwk from './jwk';
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
  jwkPrivate: any
): Promise<JwsFlattened> {
  jwk.validateJwkPrivate(jwkPrivate);

  const protectedHeaderString = JSON.stringify(protectedHeader);
  const protectedHeaderBase64UrlString = base64url.encode(protectedHeaderString);
  const payloadBase64UrlString = base64url.encode(payload);
  const signingInputBase64urlString = protectedHeaderBase64UrlString + '.' + payloadBase64UrlString;
  const signingInputBuffer = Buffer.from(signingInputBase64urlString);

  // This is where we will add support for different algorithms over time.
  let dsaSign: (signingInputBuffer: Buffer, privateKeyJwk: JwkPrivate) => Promise<Buffer>;
  if (jwkPrivate.crv === 'Ed25519') {
    dsaSign = ed25519.sign;
  } else if (jwkPrivate.crv === 'secp256k1') {
    dsaSign = secp256k1.sign;
  }

  const signatureBuffer = await dsaSign(signingInputBuffer, jwkPrivate);
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
  jwsFlattened: JwsFlattened,
  jwkPublic: any
): Promise<boolean> {
  jwk.validateJwkPublic(jwkPublic);

  const signatureInput = jwsFlattened.protected + '.' + jwsFlattened.payload;
  const signatureInputBuffer = Buffer.from(signatureInput);
  const signatureBuffer = base64url.toBuffer(jwsFlattened.signature);

  // This is where we will add support for different algorithms over time.
  let dsaVerify: (signingInputBuffer: Buffer, signatureBuffer: Buffer, jwkPublic: JwkPublic) => Promise<boolean>;
  if (jwkPublic.crv === 'Ed25519') {
    dsaVerify = ed25519.verify;
  } else if (jwkPublic.crv === 'secp256k1') {
    dsaVerify = secp256k1.verify;
  }

  const result = await dsaVerify(signatureInputBuffer, signatureBuffer, jwkPublic);
  return result;
}
