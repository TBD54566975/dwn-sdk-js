import crossFetch from 'cross-fetch';
import type { DidMethodResolver, DidResolutionResult } from './did-resolver.js';

/**
 * Resolver for ION DIDs.
 */
export class DidIonResolver implements DidMethodResolver {

  // supports fetch in: node, browsers, and browser extensions.
  // uses native fetch if available in environment or falls back to a ponyfill.
  // 'cross-fetch' is a ponyfill that uses `XMLHTTPRequest` under the hood.
  // `XMLHTTPRequest` cannot be used in browser extension background service workers.
  // browser extensions get even more strict with `fetch` in that it cannot be referenced
  // indirectly.
  // member field allows for test stubbing
  private fetch = globalThis.fetch ?? crossFetch;

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
    const response = await this.fetch(resolutionUrl);

    if (response.status !== 200) {
      throw new Error(`unable to resolve ${did}, got http status ${response.status}`);
    }

    const didResolutionResult = await response.json();
    return didResolutionResult;
  }

  async dump(): Promise<void> {
  }
}
