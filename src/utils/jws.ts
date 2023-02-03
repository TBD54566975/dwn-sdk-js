import isPlainObject from 'lodash/isPlainObject.js';

import { Encoder } from './encoder.js';
import { GeneralJws } from '../jose/jws/general/types.js';
import { PublicJwk } from '../jose/types.js';
import { SignatureEntry } from '../jose/jws/general/types.js';
import { signers as verifiers } from '../jose/algorithms/signing/signers.js';

/**
 * Utility class for JWS related operations.
 */
export class Jws {
  /**
   * Gets the `kid` from a general JWS signature entry.
   */
  public static getKid(signatureEntry: SignatureEntry): string {
    const { kid } = Encoder.base64UrlToObject(signatureEntry.protected);
    return kid;
  }

  /**
   * Gets the signer DID from a general JWS signature entry.
   */
  public static getSignerDid(signatureEntry: SignatureEntry): string {
    const kid = Jws.getKid(signatureEntry);
    const did = Jws.extractDid(kid);
    return did;
  }

  public static async verifySignature(base64UrlPayload: string, signatureEntry: SignatureEntry, jwkPublic: PublicJwk): Promise<boolean> {
    const verifier = verifiers[jwkPublic.crv];

    if (!verifier) {
      throw new Error(`unsupported crv. crv must be one of ${Object.keys(verifiers)}`);
    }

    const payload = Encoder.stringToBytes(`${signatureEntry.protected}.${base64UrlPayload}`);
    const signatureBytes = Encoder.base64UrlToBytes(signatureEntry.signature);

    return await verifier.verify(payload, signatureBytes, jwkPublic);
  }

  public static decodePlainObjectPayload(jws: GeneralJws): any {
    let payloadJson;
    try {
      payloadJson = Encoder.base64UrlToObject(jws.payload);
    } catch {
      throw new Error('signed payload is not a JSON object');
    }

    if (!isPlainObject(payloadJson)) {
      throw new Error('signed payload must be a valid JSON object');
    }

    return payloadJson;
  }

  /**
   * Extracts the DID from the given `kid` string.
   */
  public static extractDid(kid: string): string {
    const [ did ] = kid.split('#');
    return did;
  }
}
