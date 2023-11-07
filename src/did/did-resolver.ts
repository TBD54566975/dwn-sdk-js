import type { Cache } from '../types/cache.js';
import type { DidMethodResolver, DidResolutionResult } from '../types/did-types.js';

import { Did } from './did.js';
import { DidIonResolver } from './did-ion-resolver.js';
import { DidKeyResolver } from './did-key-resolver.js';
import { MemoryCache } from '../utils/memory-cache.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

/**
 * A DID resolver that by default supports `did:key` and `did:ion` DIDs.
 */
export class DidResolver {
  private didResolvers: Map<string, DidMethodResolver>;
  private cache: Cache;

  constructor(resolvers?: DidMethodResolver[], cache?:Cache) {

    this.cache = cache || new MemoryCache(600);

    // construct default DID method resolvers if none given
    if (resolvers === undefined || resolvers.length === 0) {
      resolvers = [
        new DidIonResolver(),
        new DidKeyResolver()
      ];
    }

    this.didResolvers = new Map();

    for (const resolver of resolvers) {
      this.didResolvers.set(resolver.method(), resolver);
    }
  }

  /**
   * attempt to resolve the DID provided
   * @throws {Error} if DID is invalid
   * @throws {Error} if DID method is not supported
   * @throws {Error} if resolving DID fails
   * @param did - the DID to resolve
   * @returns {DidResolutionResult}
   */
  public async resolve(did: string): Promise<DidResolutionResult> {
    // naively validate the given DID
    Did.validate(did);
    const splitDID = did.split(':', 3);

    const didMethod = splitDID[1];
    const didResolver = this.didResolvers.get(didMethod);

    if (!didResolver) {
      throw new DwnError(DwnErrorCode.DidMethodNotSupported, `${didMethod} DID method not supported`);
    }

    // use cached result if exists
    const cachedResolutionResult = await this.cache.get(did);
    const resolutionResult = cachedResolutionResult ?? await didResolver.resolve(did);
    if (cachedResolutionResult === undefined){
      await this.cache.set(did, resolutionResult);
    }

    const { didDocument, didResolutionMetadata } = resolutionResult;

    if (!didDocument || didResolutionMetadata?.error) {
      const { error } = didResolutionMetadata;
      let errMsg = `Failed to resolve DID ${did}.`;
      errMsg += error ? ` Error: ${error}` : '';

      throw new DwnError(DwnErrorCode.DidResolutionFailed, errMsg);
    }

    return resolutionResult;
  }
}
