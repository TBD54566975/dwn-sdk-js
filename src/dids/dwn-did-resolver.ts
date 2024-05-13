import { Did, DidResolutionOptions, DidResolutionResult, DidResolver, EMPTY_DID_RESOLUTION_RESULT, UniversalResolver } from '@web5/dids';
import { removeUndefinedProperties } from '../utils/object.js';

export type DwnDidResolverOptions = {
  dhtGatewayUrl?: string;
  ionGatewayUrl?: string;
}

export class DwnDidResolver implements DidResolver {

  constructor(private options: DwnDidResolverOptions, private resolver: UniversalResolver) {}

  public resolve(didUrl: string, options?: DidResolutionOptions): Promise<DidResolutionResult> {
    const parsedDid = Did.parse(didUrl);
    if (!parsedDid) {
      return Promise.resolve({
        ...EMPTY_DID_RESOLUTION_RESULT,
        didResolutionMetadata: {
          error: 'InvalidDid',
          errorMessage: `Invalid DID URI: ${didUrl}`
        }
      });
    }
    
    let resolutionOptions = options || {};

    switch(parsedDid.method) {
      case 'dht':
        resolutionOptions = {
          ...resolutionOptions,
          gatewayUri: this.options.dhtGatewayUrl
        }
        break;
      case 'ion':
        resolutionOptions = {
          ...resolutionOptions,
          gatewayUri: this.options.ionGatewayUrl
        }
        break;
    }

    removeUndefinedProperties(resolutionOptions);

    return this.resolver.resolve(didUrl, resolutionOptions);
  }
}