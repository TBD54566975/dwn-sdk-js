import { Ed25519KeyPair } from '@transmute/ed25519-key-pair';
import JwkEd25519 from './JwkEd25519';
import randomBytes from 'randombytes';

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
    const keyPair = await Ed25519KeyPair.generate({
      secureRandom: () => randomBytes(32)
    });

    const exportedKeyPair = await keyPair.export({
      type: 'JsonWebKey2020',
      privateKey: true
    });
    
    const { publicKeyJwk, privateKeyJwk } = exportedKeyPair as any;
    publicKeyJwk.alg = 'EdDSA';
    privateKeyJwk.alg = 'EdDSA';
 
    return { publicKeyJwk, privateKeyJwk};
  }
}
