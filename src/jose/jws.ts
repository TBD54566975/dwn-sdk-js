import * as ed25519 from './algorithms/ed25519';
import * as secp256k1 from './algorithms/secp256k1';

import { base64url } from 'multiformats/bases/base64';

import type { JwkPrivate, JwkPublic } from './types';

type Signer = (payload: Uint8Array, privateKeyJwk: JwkPrivate) => Promise<Uint8Array>;
type Verifier = (payload: Uint8Array, signature: Uint8Array, publicKeyJwk: JwkPublic) => Promise<boolean>;

const verifiers: { [key:string]: Verifier } = {
  'Ed25519'   : ed25519.verify,
  'secp256k1' : secp256k1.verify
};

const signers: { [key:string]: Signer } = {
  'Ed25519'   : ed25519.sign,
  'secp256k1' : secp256k1.sign
};

/**
 * Signs the given payload as a JWS.
 * NOTE: this is mainly used by tests to create valid test data.
 * @throws {Error} if the provided key is unsupported.
 */

type SignatureInput = {
  protectedHeader: JwsHeaderParameters
  jwkPrivate: JwkPrivate
};

export async function sign(payload: Uint8Array, signatures: SignatureInput[]): Promise<GeneralJws> {
  const payloadBase64UrlString = base64url.baseEncode(payload);

  const jws: GeneralJws = {
    payload    : payloadBase64UrlString,
    signatures : []
  };

  for (let { protectedHeader, jwkPrivate } of signatures) {
    const signFn: Signer = signers[jwkPrivate.crv];

    if (!signFn) {
      throw new Error(`unsupported crv. crv must be one of ${Object.keys(signers)}`);
    }

    const protectedHeaderString = JSON.stringify(protectedHeader);
    const protectedHeaderBytes = new TextEncoder().encode(protectedHeaderString);
    const protectedHeaderBase64UrlString = base64url.baseEncode(protectedHeaderBytes);

    const signingInputBase64urlString = `${protectedHeaderBase64UrlString}.${payloadBase64UrlString}`;
    const signingInputBytes = new TextEncoder().encode(signingInputBase64urlString);

    const signatureBytes = await signFn(signingInputBytes, jwkPrivate);
    const signature = base64url.baseEncode(signatureBytes);

    jws.signatures.push({ protected: protectedHeaderBase64UrlString, signature });
  }

  return jws;
}

/**
 * Verifies the JWS signature.
 * @returns `true` if signature is successfully verified, false otherwise.
 * @throws {Error} if key given is unsupported.
 */
export async function verify(base64UrlPayload: string, signature: Signature, jwkPublic: JwkPublic): Promise<boolean> {
  const verifyFn: Verifier = verifiers[jwkPublic.crv];

  if (!verifyFn) {
    throw new Error(`unsupported crv. crv must be one of ${Object.keys(verifiers)}`);
  }

  const payload = new TextEncoder().encode(`${signature.protected}.${base64UrlPayload}`);
  const signatureBytes = base64url.baseDecode(signature.signature);

  return await verifyFn(payload, signatureBytes, jwkPublic);
}
