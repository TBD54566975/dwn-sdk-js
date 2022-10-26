import type { GeneralJws, SignatureEntry } from './types';
import type { PublicJwk } from '../../types';
import type { VerificationMethod } from '../../../did/did-resolver';
import * as encoder from '../../../utils/encoder';
import { DidResolver } from '../../../did/did-resolver';
import { signers as verifiers } from '../../algorithms';
import { validate } from '../../../validation/validator';

type VerificationResult = {
  /** DIDs of all signers */
  signers: string[];
};

// TODO: add logic to prevent validating duplicate signatures, Issue #66 https://github.com/TBD54566975/dwn-sdk-js/issues/66
export class GeneralJwsVerifier {
  jws: GeneralJws;

  constructor(jws: GeneralJws) {
    this.jws = jws;
  }

  async verify(didResolver: DidResolver): Promise<VerificationResult> {
    const signers: string[] = [];

    for (const signatureEntry of this.jws.signatures) {
      const kid = GeneralJwsVerifier.getKid(signatureEntry);
      const publicJwk = await GeneralJwsVerifier.getPublicKey(kid, didResolver);

      const isVerified = await GeneralJwsVerifier.verifySignature(this.jws.payload, signatureEntry, publicJwk);
      const did = GeneralJwsVerifier.extractDid(kid);

      if (isVerified) {
        signers.push(did);
      } else {
        throw new Error(`signature verification failed for ${did}`);
      }
    }

    return { signers };
  }

  /**
   * Gets the `kid` from a general JWS signature entry.
   */
  private static getKid(signatureEntry: SignatureEntry): string {
    const protectedHeaderBytes = encoder.base64urlToBytes(signatureEntry.protected);
    const protectedHeaderJson = encoder.bytesToString(protectedHeaderBytes);

    const { kid } = JSON.parse(protectedHeaderJson);
    return kid;
  }

  /**
   * Gets the DID from a general JWS signature entry.
   */
  public static getDid(signatureEntry: SignatureEntry): string {
    const kid = GeneralJwsVerifier.getKid(signatureEntry);
    const did = GeneralJwsVerifier.extractDid(kid);
    return did;
  }

  /**
   * Gets the public key given a fully qualified key ID (`kid`).
   */
  static async getPublicKey(kid: string, didResolver: DidResolver): Promise<PublicJwk> {
    // `resolve` throws exception if DID is invalid, DID method is not supported,
    // or resolving DID fails
    const did = GeneralJwsVerifier.extractDid(kid);
    const { didDocument } = await didResolver.resolve(did);
    const { verificationMethod: verificationMethods = [] } = didDocument || {};

    let verificationMethod: VerificationMethod | undefined;

    for (const vm of verificationMethods) {
      // consider optimizing using a set for O(1) lookups if needed
      // key ID in DID Document may or may not be fully qualified. e.g.
      // `did:ion:alice#key1` or `#key1`
      if (kid.endsWith(vm.id)) {
        verificationMethod = vm;
        break;
      }
    }

    if (!verificationMethod) {
      throw new Error('public key needed to verify signature not found in DID Document');
    }

    validate('JwkVerificationMethod', verificationMethod);

    const { publicKeyJwk: publicJwk } = verificationMethod;

    // TODO: replace with JSON Schema based validation, Issue 68 https://github.com/TBD54566975/dwn-sdk-js/issues/68
    // more info about the `publicJwk` property can be found here:
    // https://www.w3.org/TR/did-spec-registries/#publicJwk
    if (!publicJwk) {
      throw new Error(`publicKeyJwk property not found on verification method [${kid}]`);
    }

    return publicJwk as PublicJwk;
  }

  static async verifySignature(base64UrlPayload: string, signatureEntry: SignatureEntry, jwkPublic: PublicJwk): Promise<boolean> {
    const verifier = verifiers[jwkPublic.crv];

    if (!verifier) {
      throw new Error(`unsupported crv. crv must be one of ${Object.keys(verifiers)}`);
    }

    const payload = encoder.stringToBytes(`${signatureEntry.protected}.${base64UrlPayload}`);
    const signatureBytes = encoder.base64urlToBytes(signatureEntry.signature);

    return await verifier.verify(payload, signatureBytes, jwkPublic);
  }

  static decodeJsonPayload(jws: GeneralJws): any {
    try {
      const payloadBytes = encoder.base64urlToBytes(jws.payload);
      const payloadString = encoder.bytesToString(payloadBytes);
      const payloadJson = JSON.parse(payloadString);
      return payloadJson;
    } catch {
      throw new Error('auth payload must be a valid JSON object');
    }
  }

  /**
   * Extracts the DID from the given `kid` string.
   */
  public static extractDid(kid: string): string {
    const [ did ] = kid.split('#');
    return did;
  }
}