import type { Cache } from '../../../types/cache.js';
import type { DidResolver } from '../../../did/did-resolver.js';
import type { GeneralJws } from '../../../types/jws-types.js';
import type { PublicJwk } from '../../../types/jose-types.js';
import type { VerificationMethod } from '../../../types/did-types.js';

import { Jws } from '../../../utils/jws.js';
import { MemoryCache } from '../../../utils/memory-cache.js';
import { validateJsonSchema } from '../../../schema-validator.js';
import { DwnError, DwnErrorCode } from '../../../core/dwn-error.js';

type VerificationResult = {
  /** DIDs of all signers */
  signers: string[];
};

/**
 * Verifies the signature(s) of a General JWS.
 */
export class GeneralJwsVerifier {

  private static _singleton: GeneralJwsVerifier;

  cache: Cache;

  private constructor(cache?: Cache) {
    this.cache = cache || new MemoryCache(600);
  }

  private static get singleton(): GeneralJwsVerifier {
    if (GeneralJwsVerifier._singleton === undefined) {
      GeneralJwsVerifier._singleton = new GeneralJwsVerifier();
    }

    return GeneralJwsVerifier._singleton;
  }

  /**
   * Verifies the signatures of the given General JWS.
   * @returns the list of signers that have valid signatures.
   */
  public static async verifySignatures(jws: GeneralJws, didResolver: DidResolver): Promise<VerificationResult> {
    return await GeneralJwsVerifier.singleton.verifySignatures(jws, didResolver);
  }

  /**
   * Verifies the signatures of the given General JWS.
   * @returns the list of signers that have valid signatures.
   */
  public async verifySignatures(jws: GeneralJws, didResolver: DidResolver): Promise<VerificationResult> {
    const signers: string[] = [];

    for (const signatureEntry of jws.signatures) {
      let isVerified: boolean;
      const kid = Jws.getKid(signatureEntry);

      const cacheKey = `${signatureEntry.protected}.${jws.payload}.${signatureEntry.signature}`;
      const cachedValue = await this.cache.get(cacheKey);

      // explicit `undefined` check to differentiate `false`
      if (cachedValue === undefined) {
        const publicJwk = await GeneralJwsVerifier.getPublicKey(kid, didResolver);
        isVerified = await Jws.verifySignature(jws.payload, signatureEntry, publicJwk);
        await this.cache.set(cacheKey, isVerified);
      } else {
        isVerified = cachedValue;
      }

      const did = Jws.extractDid(kid);

      if (isVerified) {
        signers.push(did);
      } else {
        throw new DwnError(DwnErrorCode.GeneralJwsVerifierInvalidSignature, `Signature verification failed for ${did}`);
      }
    }

    return { signers };
  }

  /**
   * Gets the public key given a fully qualified key ID (`kid`) by resolving the DID to its DID Document.
   */
  private static async getPublicKey(kid: string, didResolver: DidResolver): Promise<PublicJwk> {
    // `resolve` throws exception if DID is invalid, DID method is not supported,
    // or resolving DID fails
    const did = Jws.extractDid(kid);
    const { didDocument } = await didResolver.resolve(did);
    const { verificationMethod: verificationMethods = [] } = didDocument || {};

    let verificationMethod: VerificationMethod | undefined;

    for (const method of verificationMethods) {
      // consider optimizing using a set for O(1) lookups if needed
      // key ID in DID Document may or may not be fully qualified. e.g.
      // `did:ion:alice#key1` or `#key1`
      if (kid.endsWith(method.id)) {
        verificationMethod = method;
        break;
      }
    }

    if (!verificationMethod) {
      throw new DwnError(DwnErrorCode.GeneralJwsVerifierGetPublicKeyNotFound, 'public key needed to verify signature not found in DID Document');
    }

    validateJsonSchema('JwkVerificationMethod', verificationMethod);

    const { publicKeyJwk: publicJwk } = verificationMethod;

    return publicJwk as PublicJwk;
  }
}