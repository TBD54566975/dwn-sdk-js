import * as ed25519 from '@noble/ed25519';
import base64url from 'base64url';
import JwkEd25519 from './JwkEd25519';

/**
 * Class containing JWK related operations.
 */
export default class Jwk {

  /**
   * Generates ED25519 public-private key pair.
   * @returns Public and private ED25519 keys in JWK format.
   */
  public static async generateEd25519KeyPair (): Promise<{
    publicKeyJwk: JwkEd25519,
    privateKeyJwk: Required<JwkEd25519>
  }> {
    const privateKeyUint8Array = ed25519.utils.randomPrivateKey();
    const publicKeyUint8Array = await ed25519.getPublicKey(privateKeyUint8Array);
    const privateKeyBuffer = Buffer.from(privateKeyUint8Array);
    const publicKeyBuffer = Buffer.from(publicKeyUint8Array);

    const d = base64url.encode(privateKeyBuffer);
    const x = base64url.encode(publicKeyBuffer);

    const publicKeyJwk: JwkEd25519 = {
      kty : 'OKP',
      crv : 'Ed25519',
      x
    };

    const privateKeyJwk: Required<JwkEd25519> = {
      ...publicKeyJwk,
      d
    };

    return { publicKeyJwk, privateKeyJwk};
  }
}
