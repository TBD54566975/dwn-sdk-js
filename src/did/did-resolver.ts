import type { PublicJwk } from '../jose/types';

/**
 * TODO: add docs, Issue #72 https://github.com/TBD54566975/dwn-sdk-js/issues/72
 */
export class DIDResolver {
  didResolvers: Map<string, DIDMethodResolver>;

  // TODO: add DIDCache to constructor method signature, Issue #62 https://github.com/TBD54566975/dwn-sdk-js/issues/62
  constructor(resolvers: DIDMethodResolver[]) {
    this.didResolvers = new Map();

    for (const resolver of resolvers) {
      this.didResolvers.set(resolver.method(), resolver);
    }
  }

  /**
   * attempt to resolve the DID provided using the available DIDMethodResolvers
   * @throws {Error} if DID is invalid
   * @throws {Error} if DID method is not supported
   * @throws {Error} if resolving DID fails
   * @param did - the DID to resolve
   * @returns {DIDResolutionResult}
   */
  public async resolve(did: string): Promise<DIDResolutionResult> {
  // naively validate requester DID
  // TODO: add better DID validation, Issue #63 https://github.com/TBD54566975/dwn-sdk-js/issues/63
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

    if (!didDocument || didResolutionMetadata?.error) {
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
   * @param did - the DID to resolve
   * @throws {Error} if unable to resolve the DID
   */
  resolve(did: string): Promise<DIDResolutionResult>;
}

export type DIDDocument = {
  '@context'?: 'https://www.w3.org/ns/did/v1' | string | string[]
  id: string
  alsoKnownAs?: string[]
  controller?: string | string[]
  verificationMethod?: VerificationMethod[]
  service?: ServiceEndpoint[]
  authentication?: VerificationMethod[] | string[]
  assertionMethod?: VerificationMethod[] | string[]
  keyAgreement?: VerificationMethod[] | string[]
  capabilityInvocation?: VerificationMethod[] | string[]
  capabilityDelegation?: VerificationMethod[] | string[]
};

export type ServiceEndpoint = {
  id: string
  type: string
  serviceEndpoint: string
  description?: string
};

// TODO: figure out if we need to support ALL verification method properties, Issue #64 https://github.com/TBD54566975/dwn-sdk-js/issues/64
//       listed here: https://www.w3.org/TR/did-spec-registries/#verification-method-properties
export type VerificationMethod = {
  id: string
  // one of the valid verification method types as per
  // https://www.w3.org/TR/did-spec-registries/#verification-method-types
  type: string
  // DID of the key's controller
  controller: string
  // a JSON Web Key that conforms to https://datatracker.ietf.org/doc/html/rfc7517
  publicKeyJwk?: PublicJwk
  // a string representation of
  // https://datatracker.ietf.org/doc/html/draft-multiformats-multibase-05
  publicKeyMultibase?: string
};

export type DIDResolutionResult = {
  '@context'?: 'https://w3id.org/did-resolution/v1' | string | string[]
  didResolutionMetadata: DIDResolutionMetadata
  didDocument: DIDDocument | null
  didDocumentMetadata: DIDDocumentMetadata
};

export type DIDResolutionMetadata = {
  contentType?: string
  error?: 'invalidDid' | 'notFound' | 'representationNotSupported' |
  'unsupportedDidMethod' | string
};

export type DIDDocumentMetadata = {
  // indicates the timestamp of the Create operation. ISO8601 timestamp
  created?: string
  // indicates the timestamp of the last Update operation for the document version which was
  // resolved. ISO8601 timestamp
  updated?: string
  // indicates whether the DID has been deactivated
  deactivated?: boolean
  // indicates the version of the last Update operation for the document version which
  // was resolved
  versionId?: string
  // indicates the timestamp of the next Update operation if the resolved document version
  // is not the latest version of the document.
  nextUpdate?: string
  // indicates the version of the next Update operation if the resolved document version
  // is not the latest version of the document.
  nextVersionId?: string
  // @see https://www.w3.org/TR/did-core/#dfn-equivalentid
  equivalentId?: string
  // @see https://www.w3.org/TR/did-core/#dfn-canonicalid
  canonicalId?: string
};