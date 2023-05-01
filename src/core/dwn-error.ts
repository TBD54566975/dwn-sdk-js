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
  MessageStoreDataCidMismatch = 'MessageStoreDataCidMismatch',
  MessageStoreDataNotFound = 'MessageStoreDataNotFound',
  MessageStoreDataSizeMismatch = 'MessageStoreDataSizeMismatch',
  ProtocolAuthorizationIncorrectDataFormat = 'ProtocolAuthorizationIncorrectDataFormat',
  ProtocolAuthorizationIncorrectProtocolPath = 'ProtocolAuthorizationIncorrectProtocolPath',
  ProtocolAuthorizationInvalidSchema = 'ProtocolAuthorizationInvalidSchema',
  ProtocolAuthorizationInvalidRecordType = 'ProtocolAuthorizationInvalidRecordType',
  ProtocolAuthorizationMissingRuleSet = 'ProtocolAuthorizationMissingRuleSet',
  RecordsDecryptNoMatchingKeyDerivationScheme = 'RecordsDecryptNoMatchingKeyDerivationScheme',
  RecordsDeriveLeafPrivateKeyUnSupportedCurve = 'RecordsDeriveLeafPrivateKeyUnSupportedCurve',
  RecordsDeriveLeafPublicKeyUnSupportedCurve = 'RecordsDeriveLeafPublicKeyUnSupportedCurve',
  RecordsInvalidAncestorKeyDerivationSegment = 'RecordsInvalidAncestorKeyDerivationSegment',
  RecordsProtocolsDerivationSchemeMissingProtocol = 'RecordsProtocolsDerivationSchemeMissingProtocol',
  RecordsSchemasDerivationSchemeMissingSchema = 'RecordsSchemasDerivationSchemeMissingSchema',
  RecordsWriteGetEntryIdUndefinedAuthor = 'RecordsWriteGetEntryIdUndefinedAuthor',
  RecordsWriteValidateIntegrityEncryptionCidMismatch = 'RecordsWriteValidateIntegrityEncryptionCidMismatch',
  Secp256k1KeyNotValid = 'Secp256k1KeyNotValid',
  UrlProtocolNotNormalized = 'UrlProtocolNotNormalized',
  UrlProtocolNotNormalizable = 'UrlProtocolNotNormalizable',
  UrlSchemaNotNormalized = 'UrlSchemaNotNormalized',
  UrlSchemaNotNormalizable = 'UrlSchemaNotNormalizable'
};
