import * as Ed25519 from '@noble/ed25519';
import type { PrivateJwk, PublicJwk, SignatureAlgorithm } from '../../../types/jose-types.js';

import { Encoder } from '../../../utils/encoder.js';
import { DwnError, DwnErrorCode } from '../../../core/dwn-error.js';

function validateKey(jwk: PrivateJwk | PublicJwk): void {
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') {
    throw new DwnError(DwnErrorCode.Ed25519InvalidJwk, 'invalid jwk. kty MUST be OKP. crv MUST be Ed25519');
  }
}

function publicKeyToJwk(publicKeyBytes: Uint8Array): PublicJwk {
  const x = Encoder.bytesToBase64Url(publicKeyBytes);

  const publicJwk: PublicJwk = {
    alg : 'EdDSA',
    kty : 'OKP',
    crv : 'Ed25519',
    x
  };

  return publicJwk;
}

export const ed25519: SignatureAlgorithm = {
  sign: async (content: Uint8Array, privateJwk: PrivateJwk): Promise<Uint8Array> => {
    validateKey(privateJwk);

    const contentHex = Ed25519.etc.bytesToHex(content);
    const privateKeyBytes = Encoder.base64UrlToBytes(privateJwk.d);
    const privateKeyHex = Ed25519.etc.bytesToHex(privateKeyBytes);

    return Ed25519.signAsync(contentHex, privateKeyHex);
  },

  verify: async (content: Uint8Array, signature: Uint8Array, publicJwk: PublicJwk): Promise<boolean> => {
    validateKey(publicJwk);

    const publicKeyBytes = Encoder.base64UrlToBytes(publicJwk.x);

    return Ed25519.verifyAsync(signature, content, publicKeyBytes);
  },

  generateKeyPair: async (): Promise<{publicJwk: PublicJwk, privateJwk: PrivateJwk}> => {
    const privateKeyBytes = Ed25519.utils.randomPrivateKey();
    const privateKeyHex = Ed25519.etc.bytesToHex(privateKeyBytes);
    const publicKeyBytes = await Ed25519.getPublicKeyAsync(privateKeyHex);

    const d = Encoder.bytesToBase64Url(privateKeyBytes);

    const publicJwk = publicKeyToJwk(publicKeyBytes);
    const privateJwk: PrivateJwk = { ...publicJwk, d };

    return { publicJwk, privateJwk };
  },

  publicKeyToJwk: async (publicKeyBytes: Uint8Array): Promise<PublicJwk> => {
    return publicKeyToJwk(publicKeyBytes);
  }
};