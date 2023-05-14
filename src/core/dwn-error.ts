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
  HdKeyDerivationPathInvalid = 'HdKeyDerivationPathInvalid',
  ProtocolAuthorizationIncorrectDataFormat = 'ProtocolAuthorizationIncorrectDataFormat',
  ProtocolAuthorizationIncorrectProtocolPath = 'ProtocolAuthorizationIncorrectProtocolPath',
  ProtocolAuthorizationInvalidSchema = 'ProtocolAuthorizationInvalidSchema',
  ProtocolAuthorizationInvalidType = 'ProtocolAuthorizationInvalidType',
  ProtocolAuthorizationMissingRuleSet = 'ProtocolAuthorizationMissingRuleSet',
  RecordsDecryptNoMatchingKeyEncryptedFound = 'RecordsDecryptNoMatchingKeyEncryptedFound',
  RecordsDeriveLeafPrivateKeyUnSupportedCurve = 'RecordsDeriveLeafPrivateKeyUnSupportedCurve',
  RecordsDeriveLeafPublicKeyUnSupportedCurve = 'RecordsDeriveLeafPublicKeyUnSupportedCurve',
  RecordsInvalidAncestorKeyDerivationSegment = 'RecordsInvalidAncestorKeyDerivationSegment',
  RecordsProtocolsDerivationSchemeMissingProtocol = 'RecordsProtocolsDerivationSchemeMissingProtocol',
  RecordsSchemasDerivationSchemeMissingSchema = 'RecordsSchemasDerivationSchemeMissingSchema',
  RecordsWriteGetEntryIdUndefinedAuthor = 'RecordsWriteGetEntryIdUndefinedAuthor',
  RecordsWriteMissingDataStream = 'RecordsWriteMissingDataStream',
  RecordsWriteValidateIntegrityEncryptionCidMismatch = 'RecordsWriteValidateIntegrityEncryptionCidMismatch',
  Secp256k1KeyNotValid = 'Secp256k1KeyNotValid',
  RecordsWriteDataCidMismatch = 'StorageControllerDataCidMismatch',
  RecordsWriteDataSizeMismatch = 'StorageControllerDataSizeMismatch',
  RecordsWriteMissingData = 'StorageControllerMissingData',
  StorageControllerMissingDataCid = 'StorageControllerMissingDataCid',
  UrlProtocolNotNormalized = 'UrlProtocolNotNormalized',
  UrlProtocolNotNormalizable = 'UrlProtocolNotNormalizable',
  UrlSchemaNotNormalized = 'UrlSchemaNotNormalized',
  UrlSchemaNotNormalizable = 'UrlSchemaNotNormalizable'
};
