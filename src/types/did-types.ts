import type { PublicJwk } from './jose-types.js';

/**
 * A generalized interface that can be implemented for individual
 * DID methods
 */
export interface DidMethodResolver {
  /**
   * @returns the DID method supported by {@link DidMethodResolver.resolve}
   */
  method(): string;

  /**
   * attempts to resolve the DID provided into its respective DID Document.
   * More info on resolving DIDs can be found
   * {@link https://www.w3.org/TR/did-core/#resolution here}
   * @param did - the DID to resolve
   * @throws {Error} if unable to resolve the DID
   */
  resolve(did: string): Promise<DidResolutionResult>;
}



export type DidDocument = {
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

export type DwnServiceEndpoint = {
  nodes: string[]
};

export type ServiceEndpoint = {
  id: string
  type: string
  serviceEndpoint: string | DwnServiceEndpoint
  description?: string
};

export type VerificationMethod = {
  id: string
  // one of the valid verification method types as per
  // https://www.w3.org/TR/did-spec-registries/#verification-method-types
  type: string
  // DID of the key's controller
  controller: string
  // a JSON Web Key that conforms to https://datatracker.ietf.org/doc/html/rfc7517
  publicKeyJwk?: PublicJwk
};

export type DidResolutionResult = {
  '@context'?: 'https://w3id.org/did-resolution/v1' | string | string[]
  didResolutionMetadata: DidResolutionMetadata
  didDocument?: DidDocument
  didDocumentMetadata: DidDocumentMetadata
};

export type DidResolutionMetadata = {
  contentType?: string
  error?: 'invalidDid' | 'notFound' | 'representationNotSupported' |
  'unsupportedDidMethod' | string
};

export type DidDocumentMetadata = {
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