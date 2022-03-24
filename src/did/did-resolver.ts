/**
 * TODO: add docs
 */
export class DIDResolver {
  didResolvers: Map<string, DIDMethodResolver>;

  // TODO: add DIDCache to constructor method signature
  constructor(resolvers: DIDMethodResolver[]) {
    this.didResolvers = new Map();

    for (let resolver of resolvers) {
      this.didResolvers.set(resolver.method(), resolver);
    }
  }

  async resolve(did: string): Promise<DIDResolutionResult> {
  // naively validate requester DID
  // TODO: add better DID validation
    const splitDID = did.split(':', 3);
    if (splitDID.length < 3) {
      throw new Error(`${did} is not a valid DID`);
    }

    const didMethod = splitDID[1];
    const didResolver = this.didResolvers.get(didMethod);

    if (!didResolver) {
      throw new Error(`${didMethod} DID method not supported`);
    }

    const resolutionResult = await didResolver.resolve(did);
    const { didDocument, didResolutionMetadata } = resolutionResult;

    if (!didDocument || didResolutionMetadata.error) {
      const { error } = didResolutionMetadata;
      let errMsg = `Failed to resolve DID ${did}.`;
      errMsg += error ? ` Error: ${error}` : '';

      throw new Error(errMsg);
    }

    return resolutionResult;
  }
}

/**
 * A generalized interface that can be implemented for individual
 * DID methods
 */
export interface DIDMethodResolver {
  /**
   * @returns the DID method supported by {@link DIDMethodResolver.resolve}
   */
  method(): string;

  /**
   * attempts to resolve the DID provided into its respective DID Document.
   * More info on resolving DIDs can be found
   * {@link https://www.w3.org/TR/did-core/#resolution here}
   * @param DID - the DID to resolve
   */
  resolve(DID: string): Promise<DIDResolutionResult>;
}

import type { JWK } from 'jose';

export type DIDDocument = {
  '@context'?: 'https://www.w3.org/ns/did/v1' | string | string[]
  id: string
  alsoKnownAs?: string[]
  controller?: string | string[]
  verificationMethod?: VerificationMethod[]
  service?: ServiceEndpoint[]
  authentication?: VerificationMethod[]
  assertionMethod?: VerificationMethod[]
  keyAgreement?: VerificationMethod[]
  capabilityInvocation?: VerificationMethod[]
  capabilityDelegation?: VerificationMethod[]
}

export type ServiceEndpoint = {
  id: string
  type: string
  serviceEndpoint: string
  description?: string
}

export type VerificationMethod = {
  id: string
  type: string
  controller: string
  publicKeyBase58?: string
  publicKeyBase64?: string
  publicKeyJwk?: JWK
  publicKeyHex?: string
  publicKeyMultibase?: string
}

export type DIDResolutionResult = {
  '@context'?: 'https://w3id.org/did-resolution/v1' | string | string[]
  didResolutionMetadata: DIDResolutionMetadata
  didDocument: DIDDocument | null
  didDocumentMetadata: DIDDocumentMetadata
}

export type DIDResolutionMetadata = {
  contentType?: string
  error?: 'invalidDid' | 'notFound' | 'representationNotSupported' |
  'unsupportedDidMethod' | string
}

export type DIDDocumentMetadata = {
  created?: string
  updated?: string
  deactivated?: boolean
  versionId?: string
  nextUpdate?: string
  nextVersionId?: string
  equivalentId?: string
  canonicalId?: string
}