import * as ed25519 from '@noble/ed25519';
import base64url from 'base64url';
import type { JwkEd25519Private, JwkEd25519Public } from './jwk-types';

/**
 * Class containing JWK related operations.
 */
export class Jwk {

  /**
   * Generates ED25519 public-private key pair.
   * @returns Public and private ED25519 keys in JWK format.
   */
  public static async generateEd25519KeyPair (): Promise<{
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

    return { publicKeyJwk, privateKeyJwk};
  }
}
