import crossFetch from 'cross-fetch';
import { DIDMethodResolver, DIDResolutionResult } from './did-resolver';

/**
 * Resolver for ION DIDs.
 */
export class IonDidResolver implements DIDMethodResolver {
  // cross-platform fetch
  private fetch = crossFetch;

  /**
   * @param resolutionEndpoint URL to send DID resolution request to
   */
  constructor (private resolutionEndpoint: string) { }
  method(): string {
    return 'ion';
  }

  async resolve(did: string): Promise<DIDResolutionResult> {
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
}
