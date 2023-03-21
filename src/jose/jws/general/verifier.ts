import type { Cache } from '../../../utils/types.js';
import type { GeneralJws } from './types.js';
import type { PublicJwk } from '../../types.js';
import type { DidResolver, VerificationMethod } from '../../../did/did-resolver.js';

import { Jws } from '../../../utils/jws.js';
import { MemoryCache } from '../../../utils/memory-cache.js';
import { validateJsonSchema } from '../../../schema-validator.js';

type VerificationResult = {
  /** DIDs of all signers */
  signers: string[];
};

export class GeneralJwsVerifier {
  jws: GeneralJws;
  cache: Cache;

  constructor(jws: GeneralJws, cache?: Cache) {
    this.jws = jws;
    this.cache = cache || new MemoryCache(600);
  }

  async verify(didResolver: DidResolver): Promise<VerificationResult> {
    const signers: string[] = [];

    for (const signatureEntry of this.jws.signatures) {
      let isVerified: boolean;
      const cacheKey = `${signatureEntry.protected}.${this.jws.payload}.${signatureEntry.signature}`;
      const kid = Jws.getKid(signatureEntry);
      const publicJwk = await GeneralJwsVerifier.getPublicKey(kid, didResolver);

      const cachedValue = await this.cache.get(cacheKey);

      // explicit strict equality check to avoid potential buggy cache implementation causing incorrect truthy compare e.g. "false"
      if (cachedValue === undefined) {
        isVerified = await Jws.verifySignature(this.jws.payload, signatureEntry, publicJwk);
        await this.cache.set(cacheKey, isVerified);
      } else {
        isVerified = cachedValue;
      }

      const did = Jws.extractDid(kid);

      if (isVerified) {
        signers.push(did);
      } else {
        throw new Error(`signature verification failed for ${did}`);
      }
    }

    return { signers };
  }

  /**
   * Gets the public key given a fully qualified key ID (`kid`).
   */
  public static async getPublicKey(kid: string, didResolver: DidResolver): Promise<PublicJwk> {
    // `resolve` throws exception if DID is invalid, DID method is not supported,
    // or resolving DID fails
    const did = Jws.extractDid(kid);
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

    validateJsonSchema('JwkVerificationMethod', verificationMethod);

    const { publicKeyJwk: publicJwk } = verificationMethod;

    return publicJwk as PublicJwk;
  }
}