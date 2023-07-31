/**
 * A class that represents a DWN error.
 */
export class DwnError extends Error {
  constructor (public code: string, message: string) {
    super(`${code}: ${message}`);

    this.name = 'DwnError';
  }
}

/**
 * DWN SDK error codes.
 */
export enum DwnErrorCode {
  AuthenticateJwsMissing = 'AuthenticateJwsMissing',
  AuthorizationMissing = 'AuthorizationMissing',
  AuthorizationUnknownAuthor = 'AuthorizationUnknownAuthor',
  GrantAuthorizationGrantExpired = 'GrantAuthorizationGrantExpired',
  GrantAuthorizationGrantMissing = 'GrantAuthorizationGrantMissing',
  GrantAuthorizationGrantRevoked = 'GrantAuthorizationGrantRevoked',
  GrantAuthorizationInterfaceMismatch = 'GrantAuthorizationInterfaceMismatch',
  GrantAuthorizationMethodMismatch = 'GrantAuthorizationMethodMismatch',
  GrantAuthorizationNotGrantedForTenant = 'GrantAuthorizationNotGrantedForTenant',
  GrantAuthorizationNotGrantedToAuthor = 'GrantAuthorizationNotGrantedToAuthor',
  GrantAuthorizationGrantNotYetActive = 'GrantAuthorizationGrantNotYetActive',
  HdKeyDerivationPathInvalid = 'HdKeyDerivationPathInvalid',
  PermissionsGrantGrantedByMismatch = 'PermissionsGrantGrantedByMismatch',
  PermissionsGrantUnauthorizedGrant = 'PermissionsGrantUnauthorizedGrant',
  PermissionsRevokeMissingPermissionsGrant = 'PermissionsRevokeMissingPermissionsGrant',
  PermissionsRevokeUnauthorizedRevoke = 'PermissionsRevokeUnauthorizedRevoke',
  ProtocolAuthorizationActionNotAllowed = 'ProtocolAuthorizationActionNotAllowed',
  ProtocolAuthorizationIncorrectDataFormat = 'ProtocolAuthorizationIncorrectDataFormat',
  ProtocolAuthorizationIncorrectProtocolPath = 'ProtocolAuthorizationIncorrectProtocolPath',
  ProtocolAuthorizationInvalidSchema = 'ProtocolAuthorizationInvalidSchema',
  ProtocolAuthorizationInvalidType = 'ProtocolAuthorizationInvalidType',
  ProtocolAuthorizationMissingRuleSet = 'ProtocolAuthorizationMissingRuleSet',
  ProtocolsConfigureUnauthorized = 'ProtocolsConfigureUnauthorized',
  ProtocolsQueryUnauthorized = 'ProtocolsQueryUnauthorized',
  RecordsDecryptNoMatchingKeyEncryptedFound = 'RecordsDecryptNoMatchingKeyEncryptedFound',
  RecordsDerivePrivateKeyUnSupportedCurve = 'RecordsDerivePrivateKeyUnSupportedCurve',
  RecordsInvalidAncestorKeyDerivationSegment = 'RecordsInvalidAncestorKeyDerivationSegment',
  RecordsProtocolContextDerivationSchemeMissingContextId = 'RecordsProtocolContextDerivationSchemeMissingContextId',
  RecordsProtocolPathDerivationSchemeMissingProtocol = 'RecordsProtocolPathDerivationSchemeMissingProtocol',
  RecordsSchemasDerivationSchemeMissingSchema = 'RecordsSchemasDerivationSchemeMissingSchema',
  RecordsWriteGetEntryIdUndefinedAuthor = 'RecordsWriteGetEntryIdUndefinedAuthor',
  RecordsWriteDataCidMismatch = 'RecordsWriteDataCidMismatch',
  RecordsWriteDataSizeMismatch = 'RecordsWriteDataSizeMismatch',
  RecordsWriteMissingAuthorizationSignatureInput = 'RecordsWriteMissingAuthorizationSignatureInput',
  RecordsWriteMissingData = 'RecordsWriterMissingData',
  RecordsWriteMissingDataStream = 'RecordsWriteMissingDataStream',
  RecordsWriteMissingProtocol = 'RecordsWriteMissingProtocol',
  RecordsWriteMissingSchema = 'RecordsWriteMissingSchema',
  RecordsWriteValidateIntegrityEncryptionCidMismatch = 'RecordsWriteValidateIntegrityEncryptionCidMismatch',
  Secp256k1KeyNotValid = 'Secp256k1KeyNotValid',
  UrlProtocolNotNormalized = 'UrlProtocolNotNormalized',
  UrlProtocolNotNormalizable = 'UrlProtocolNotNormalizable',
  UrlSchemaNotNormalized = 'UrlSchemaNotNormalized',
  UrlSchemaNotNormalizable = 'UrlSchemaNotNormalizable'
};
