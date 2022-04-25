// import * as crypto from 'crypto';
import { Ed25519KeyPair } from '@transmute/ed25519-key-pair';
import JwkEd25519 from './JwkEd25519';
// import * as randomBytes from 'randombytes';
import randomBytes from 'randombytes';

/**
 * Class containing operations related to keys used in ION.
 */
export default class Jwk {
  public static async generateEd25519KeyPair (): Promise<[JwkEd25519, JwkEd25519]> {
    const keyPair = await Ed25519KeyPair.generate({
      secureRandom: () => randomBytes(32)
    });

    const exportedKeypair = await keyPair.export({
      type: 'JsonWebKey2020',
      privateKey: true
    });
    
    const { publicKeyJwk, privateKeyJwk } = exportedKeypair as any;
    publicKeyJwk.alg = 'EdDSA';
    privateKeyJwk.alg = 'EdDSA';
 
    return [publicKeyJwk, privateKeyJwk];
  }
}
