import type { SignatureEntry } from '../types/jws-types.js';
import type { GeneralJws, SignatureInput } from '../types/jws-types.js';
import type { KeyMaterial, PublicJwk } from '../types/jose-types.js';

import isPlainObject from 'lodash/isPlainObject.js';

import { Encoder } from './encoder.js';
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

  /**
   * Verifies the signature against the given payload.
   * @returns `true` if signature is valid; `false` otherwise
   */
  public static async verifySignature(base64UrlPayload: string, signatureEntry: SignatureEntry, jwkPublic: PublicJwk): Promise<boolean> {
    const verifier = verifiers[jwkPublic.crv];

    if (!verifier) {
      throw new Error(`unsupported crv. crv must be one of ${Object.keys(verifiers)}`);
    }

    const payload = Encoder.stringToBytes(`${signatureEntry.protected}.${base64UrlPayload}`);
    const signatureBytes = Encoder.base64UrlToBytes(signatureEntry.signature);

    return await verifier.verify(payload, signatureBytes, jwkPublic);
  }

  /**
   * Decodes the payload of the given JWS object as a plain object.
   */
  public static decodePlainObjectPayload(jws: GeneralJws): any {
    let payloadJson;
    try {
      payloadJson = Encoder.base64UrlToObject(jws.payload);
    } catch {
      throw new Error('payload is not a JSON object');
    }

    if (!isPlainObject(payloadJson)) {
      throw new Error('signed payload must be a plain object');
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

  /**
   * Creates a SignatureInput[] from the given Personas.
   */
  public static createSignatureInputs(keyMaterials: KeyMaterial[]): SignatureInput[] {
    const signatureInputs = keyMaterials.map((keyMaterial) => Jws.createSignatureInput(keyMaterial));
    return signatureInputs;
  }

  /**
   * Creates a SignatureInput from the given Persona.
   */
  public static createSignatureInput(keyMaterial: KeyMaterial): SignatureInput {
    const signatureInput = {
      privateJwk      : keyMaterial.keyPair.privateJwk,
      protectedHeader : {
        alg : keyMaterial.keyPair.privateJwk.alg as string,
        kid : keyMaterial.keyId
      }
    };

    return signatureInput;
  }
}
