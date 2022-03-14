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