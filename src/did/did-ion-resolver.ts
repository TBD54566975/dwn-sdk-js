import type { DidMethodResolver, DidResolutionResult } from '../types/did-types.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

import crossFetch from 'cross-fetch';
// supports fetch in: node, browsers, and browser extensions.
// uses native fetch if available in environment or falls back to a ponyfill.
// 'cross-fetch' is a ponyfill that uses `XMLHTTPRequest` under the hood.
// `XMLHTTPRequest` cannot be used in browser extension background service workers.
// browser extensions get even more strict with `fetch` in that it cannot be referenced
// indirectly.
const fetch = globalThis.fetch ?? crossFetch;

/**
 * Resolver for ION DIDs.
 */
export class DidIonResolver implements DidMethodResolver {
  /**
   * @param resolutionEndpoint optional custom URL to send DID resolution request to
   */
  constructor (private resolutionEndpoint: string = 'https://discover.did.msidentity.com/1.0/identifiers/') { }

  method(): string {
    return 'ion';
  }

  async resolve(did: string): Promise<DidResolutionResult> {
    // using `URL` constructor to handle both existence and absence of trailing slash '/' in resolution endpoint
    // appending './' to DID so 'did' in 'did:ion:abc' doesn't get interpreted as a URL scheme (e.g. like 'http') due to the colon
    const resolutionUrl = new URL('./' + did, this.resolutionEndpoint).toString();
    const response = await fetch(resolutionUrl);

    if (response.status !== 200) {
      throw new DwnError(DwnErrorCode.DidResolutionFailed, `unable to resolve ${did}, got http status ${response.status}`);
    }

    const didResolutionResult = await response.json();
    return didResolutionResult;
  }
}
