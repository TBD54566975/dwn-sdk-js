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
  AuthorizationUnknownAuthor = 'AuthorizationUnknownAuthor',
  DidMethodNotSupported = 'DidMethodNotSupported',
  DidNotString = 'DidNotString',
  DidNotValid = 'DidNotValid',
  DidResolutionFailed = 'DidResolutionFailed',
  GeneralJwsVerifierInvalidSignature = 'GeneralJwsVerifierInvalidSignature',
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
  PermissionsGrantNotADelegatedGrant = 'PermissionsGrantNotADelegatedGrant',
  PermissionsGrantScopeContextIdAndProtocolPath = 'PermissionsGrantScopeContextIdAndProtocolPath',
  PermissionsGrantScopeSchemaProhibitedFields = 'PermissionsGrantScopeSchemaProhibitedFields',
  PermissionsGrantUnauthorizedGrant = 'PermissionsGrantUnauthorizedGrant',
  PermissionsRevokeMissingPermissionsGrant = 'PermissionsRevokeMissingPermissionsGrant',
  PermissionsRevokeUnauthorizedRevoke = 'PermissionsRevokeUnauthorizedRevoke',
  PrivateKeySignerUnableToDeduceAlgorithm = 'PrivateKeySignerUnableToDeduceAlgorithm',
  PrivateKeySignerUnableToDeduceKeyId = 'PrivateKeySignerUnableToDeduceKeyId',
  PrivateKeySignerUnsupportedCurve = 'PrivateKeySignerUnsupportedCurve',
  ProtocolAuthorizationActionNotAllowed = 'ProtocolAuthorizationActionNotAllowed',
  ProtocolAuthorizationDuplicateContextRoleRecipient = 'ProtocolAuthorizationDuplicateContextRoleRecipient',
  ProtocolAuthorizationDuplicateGlobalRoleRecipient = 'ProtocolAuthorizationDuplicateGlobalRoleRecipient',
  ProtocolAuthorizationIncorrectDataFormat = 'ProtocolAuthorizationIncorrectDataFormat',
  ProtocolAuthorizationIncorrectProtocolPath = 'ProtocolAuthorizationIncorrectProtocolPath',
  ProtocolAuthorizationInvalidSchema = 'ProtocolAuthorizationInvalidSchema',
  ProtocolAuthorizationInvalidType = 'ProtocolAuthorizationInvalidType',
  ProtocolAuthorizationMissingContextId = 'ProtocolAuthorizationMissingContextId',
  ProtocolAuthorizationMissingRole = 'ProtocolAuthorizationMissingRole',
  ProtocolAuthorizationMissingRuleSet = 'ProtocolAuthorizationMissingRuleSet',
  ProtocolAuthorizationParentlessIncorrectProtocolPath = 'ProtocolAuthorizationParentlessIncorrectProtocolPath',
  ProtocolAuthorizationNotARole = 'ProtocolAuthorizationNotARole',
  ProtocolAuthorizationQueryWithoutRole = 'ProtocolAuthorizationQueryWithoutRole',
  ProtocolAuthorizationRoleMissingRecipient = 'ProtocolAuthorizationRoleMissingRecipient',
  ProtocolsConfigureContextRoleAtProhibitedProtocolPath = 'ProtocolsConfigureContextRoleAtProhibitedProtocolPath',
  ProtocolsConfigureGlobalRoleAtProhibitedProtocolPath = 'ProtocolsConfigureGlobalRoleAtProhibitedProtocolPath',
  ProtocolsConfigureInvalidRole = 'ProtocolsConfigureInvalidRole',
  ProtocolsConfigureInvalidActionMissingOf = 'ProtocolsConfigureInvalidActionMissingOf',
  ProtocolsConfigureInvalidActionOfNotAllowed = 'ProtocolsConfigureInvalidActionOfNotAllowed',
  ProtocolsConfigureQueryNotAllowed = 'ProtocolsConfigureQueryNotAllowed',
  ProtocolsConfigureUnauthorized = 'ProtocolsConfigureUnauthorized',
  ProtocolsQueryUnauthorized = 'ProtocolsQueryUnauthorized',
  RecordsDecryptNoMatchingKeyEncryptedFound = 'RecordsDecryptNoMatchingKeyEncryptedFound',
  RecordsDeleteAuthorizationFailed = 'RecordsDeleteAuthorizationFailed',

  RecordsGrantAuthorizationConditionPublicationProhibited = 'RecordsGrantAuthorizationConditionPublicationProhibited',
  RecordsGrantAuthorizationConditionPublicationRequired = 'RecordsGrantAuthorizationConditionPublicationRequired',
  RecordsGrantAuthorizationScopeContextIdMismatch = 'RecordsGrantAuthorizationScopeContextIdMismatch',
  RecordsGrantAuthorizationScopeNotProtocol = 'RecordsGrantAuthorizationScopeNotProtocol',
  RecordsGrantAuthorizationScopeProtocolMismatch = 'RecordsGrantAuthorizationScopeProtocolMismatch',
  RecordsGrantAuthorizationScopeProtocolPathMismatch = 'RecordsGrantAuthorizationScopeProtocolPathMismatch',
  RecordsGrantAuthorizationScopeSchema = 'RecordsGrantAuthorizationScopeSchema',
  RecordsDerivePrivateKeyUnSupportedCurve = 'RecordsDerivePrivateKeyUnSupportedCurve',
  RecordsInvalidAncestorKeyDerivationSegment = 'RecordsInvalidAncestorKeyDerivationSegment',
  RecordsProtocolContextDerivationSchemeMissingContextId = 'RecordsProtocolContextDerivationSchemeMissingContextId',
  RecordsProtocolPathDerivationSchemeMissingProtocol = 'RecordsProtocolPathDerivationSchemeMissingProtocol',
  RecordsQueryFilterMissingRequiredProperties = 'RecordsQueryFilterMissingRequiredProperties',
  RecordsReadReturnedMultiple = 'RecordsReadReturnedMultiple',
  RecordsSchemasDerivationSchemeMissingSchema = 'RecordsSchemasDerivationSchemeMissingSchema',
  RecordsWriteCreateMissingSigner = 'RecordsWriteCreateMissingSigner',
  RecordsWriteDataCidMismatch = 'RecordsWriteDataCidMismatch',
  RecordsWriteDataSizeMismatch = 'RecordsWriteDataSizeMismatch',
  RecordsWriteGetEntryIdUndefinedAuthor = 'RecordsWriteGetEntryIdUndefinedAuthor',
  RecordsWriteMissingAuthorizationSigner = 'RecordsWriteMissingAuthorizationSigner',
  RecordsWriteMissingDataInPrevious = 'RecordsWriteMissingDataInPrevious',
  RecordsWriteMissingDataAssociation = 'RecordsWriteMissingDataAssociation',
  RecordsWriteMissingDataStream = 'RecordsWriteMissingDataStream',
  RecordsWriteMissingProtocol = 'RecordsWriteMissingProtocol',
  RecordsWriteMissingSchema = 'RecordsWriteMissingSchema',
  RecordsWriteOwnerAndTenantMismatch = 'RecordsWriteOwnerAndTenantMismatch',
  RecordsWriteSignAsOwnerUnknownAuthor = 'RecordsWriteSignAsOwnerUnknownAuthor',
  RecordsWriteValidateIntegrityDelegatedGrantAndIdExistenceMismatch = 'RecordsWriteValidateIntegrityDelegatedGrantAndIdExistenceMismatch',
  RecordsWriteValidateIntegrityEncryptionCidMismatch = 'RecordsWriteValidateIntegrityEncryptionCidMismatch',
  RecordsWriteValidateIntegrityGrantedToAndSignerMismatch = 'RecordsWriteValidateIntegrityGrantedToAndSignerMismatch',
  Secp256k1KeyNotValid = 'Secp256k1KeyNotValid',
  TimestampInvalid = 'TimestampInvalid',
  UrlProtocolNotNormalized = 'UrlProtocolNotNormalized',
  UrlProtocolNotNormalizable = 'UrlProtocolNotNormalizable',
  UrlSchemaNotNormalized = 'UrlSchemaNotNormalized',
  UrlSchemaNotNormalizable = 'UrlSchemaNotNormalizable'
};
