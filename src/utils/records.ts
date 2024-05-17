import type { DerivedPrivateJwk } from './hd-key.js';
import type { Readable } from 'readable-stream';
import type { Filter, KeyValues, StartsWithFilter } from '../types/query-types.js';
import type { GenericMessage, GenericSignaturePayload } from '../types/message-types.js';
import type { RecordsDeleteMessage, RecordsFilter, RecordsQueryMessage, RecordsReadMessage, RecordsSubscribeMessage, RecordsWriteDescriptor, RecordsWriteMessage, RecordsWriteTags, RecordsWriteTagsFilter } from '../types/records-types.js';

import { DateSort } from '../types/records-types.js';
import { Encoder } from './encoder.js';
import { Encryption } from './encryption.js';
import { FilterUtility } from './filter.js';
import { Jws } from './jws.js';
import { Message } from '../core/message.js';
import { PermissionGrant } from '../protocols/permission-grant.js';
import { removeUndefinedProperties } from './object.js';
import { Secp256k1 } from './secp256k1.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';
import { HdKey, KeyDerivationScheme } from './hd-key.js';
import { normalizeProtocolUrl, normalizeSchemaUrl } from './url.js';

/**
 * Class containing useful utilities related to the Records interface.
 */
export class Records {

  /**
   * Checks if the given message is a `RecordsWriteMessage`.
   */
  public static isRecordsWrite(message: GenericMessage): message is RecordsWriteMessage {
    const isRecordsWrite =
      message.descriptor.interface === DwnInterfaceName.Records &&
      message.descriptor.method === DwnMethodName.Write;

    return isRecordsWrite;
  }

  /**
   * Gets the DID of the author of the given message.
   */
  public static getAuthor(message: RecordsWriteMessage | RecordsDeleteMessage): string | undefined {
    let author;

    if (message.authorization.authorDelegatedGrant !== undefined) {
      author = Message.getSigner(message.authorization.authorDelegatedGrant);
    } else {
      author = Message.getSigner(message);
    }

    return author;
  }

  /**
   * Decrypts the encrypted data in a message reply using the given ancestor private key.
   * @param ancestorPrivateKey Any ancestor private key in the key derivation path.
   */
  public static async decrypt(
    recordsWrite: RecordsWriteMessage,
    ancestorPrivateKey: DerivedPrivateJwk,
    cipherStream: Readable
  ): Promise<Readable> {
    const { encryption } = recordsWrite;

    // look for an encrypted symmetric key that is encrypted by the public key corresponding to the given private key
    const matchingEncryptedKey = encryption!.keyEncryption.find(key =>
      key.rootKeyId === ancestorPrivateKey.rootKeyId &&
      key.derivationScheme === ancestorPrivateKey.derivationScheme
    );
    if (matchingEncryptedKey === undefined) {
      throw new DwnError(
        DwnErrorCode.RecordsDecryptNoMatchingKeyEncryptedFound,
        `Unable to find a symmetric key encrypted using key \
        with ID '${ancestorPrivateKey.rootKeyId}' and '${ancestorPrivateKey.derivationScheme}' derivation scheme.`
      );
    }

    const fullDerivationPath = Records.constructKeyDerivationPath(matchingEncryptedKey.derivationScheme, recordsWrite);

    // NOTE: right now only `ECIES-ES256K` algorithm is supported for asymmetric encryption,
    // so we will assume that's the algorithm without additional switch/if statements
    const leafPrivateKey = await Records.derivePrivateKey(ancestorPrivateKey, fullDerivationPath);
    const encryptedKeyBytes = Encoder.base64UrlToBytes(matchingEncryptedKey.encryptedKey);
    const ephemeralPublicKey = Secp256k1.publicJwkToBytes(matchingEncryptedKey.ephemeralPublicKey);
    const keyEncryptionInitializationVector = Encoder.base64UrlToBytes(matchingEncryptedKey.initializationVector);
    const messageAuthenticationCode = Encoder.base64UrlToBytes(matchingEncryptedKey.messageAuthenticationCode);
    const dataEncryptionKey = await Encryption.eciesSecp256k1Decrypt({
      ciphertext           : encryptedKeyBytes,
      ephemeralPublicKey,
      initializationVector : keyEncryptionInitializationVector,
      messageAuthenticationCode,
      privateKey           : leafPrivateKey
    });


    // NOTE: right now only `A256CTR` algorithm is supported for symmetric encryption,
    // so we will assume that's the algorithm without additional switch/if statements
    const dataEncryptionInitializationVector = Encoder.base64UrlToBytes(encryption!.initializationVector);
    const plaintextStream = await Encryption.aes256CtrDecrypt(dataEncryptionKey, dataEncryptionInitializationVector, cipherStream);

    return plaintextStream;
  }

  /**
   * Constructs full key derivation path using the specified scheme.
   */
  public static constructKeyDerivationPath(
    keyDerivationScheme: KeyDerivationScheme,
    recordsWriteMessage: RecordsWriteMessage
  ): string[] {

    const descriptor = recordsWriteMessage.descriptor;
    const contextId = recordsWriteMessage.contextId;

    let fullDerivationPath;
    if (keyDerivationScheme === KeyDerivationScheme.DataFormats) {
      fullDerivationPath = Records.constructKeyDerivationPathUsingDataFormatsScheme(descriptor.schema, descriptor.dataFormat);
    } else if (keyDerivationScheme === KeyDerivationScheme.ProtocolPath) {
      fullDerivationPath = Records.constructKeyDerivationPathUsingProtocolPathScheme(descriptor);
    } else if (keyDerivationScheme === KeyDerivationScheme.ProtocolContext) {
      fullDerivationPath = Records.constructKeyDerivationPathUsingProtocolContextScheme(contextId);
    } else {
      // `schemas` scheme
      fullDerivationPath = Records.constructKeyDerivationPathUsingSchemasScheme(descriptor.schema);
    }

    return fullDerivationPath;
  }

  /**
   * Constructs the full key derivation path using `dataFormats` scheme.
   */
  public static constructKeyDerivationPathUsingDataFormatsScheme(schema: string | undefined, dataFormat: string ): string[] {
    if (schema !== undefined) {
      return [
        KeyDerivationScheme.DataFormats,
        schema, // this is as spec-ed on TP27, the intent is to support sharing the key for just a specific data type under a schema
        dataFormat
      ];
    } else {
      return [
        KeyDerivationScheme.DataFormats,
        dataFormat
      ];
    }
  }

  /**
   * Constructs the full key derivation path using `protocolPath` scheme.
   */
  public static constructKeyDerivationPathUsingProtocolPathScheme(descriptor: RecordsWriteDescriptor): string[] {
    // ensure `protocol` is defined
    // NOTE: no need to check `protocolPath` and `contextId` because earlier code ensures that if `protocol` is defined, those are defined also
    if (descriptor.protocol === undefined) {
      throw new DwnError(
        DwnErrorCode.RecordsProtocolPathDerivationSchemeMissingProtocol,
        'Unable to construct key derivation path using `protocols` scheme because `protocol` is missing.'
      );
    }

    const protocolPathSegments = descriptor.protocolPath!.split('/');
    const fullDerivationPath = [
      KeyDerivationScheme.ProtocolPath,
      descriptor.protocol,
      ...protocolPathSegments
    ];

    return fullDerivationPath;
  }

  /**
   * Constructs the full key derivation path using `protocolContext` scheme.
   */
  public static constructKeyDerivationPathUsingProtocolContextScheme(contextId: string | undefined): string[] {
    if (contextId === undefined) {
      throw new DwnError(
        DwnErrorCode.RecordsProtocolContextDerivationSchemeMissingContextId,
        'Unable to construct key derivation path using `protocolContext` scheme because `contextId` is missing.'
      );
    }

    // TODO: issue #683 -Extend key derivation support to include the full contextId (https://github.com/TBD54566975/dwn-sdk-js/issues/683)
    const firstContextSegment = contextId.split('/')[0];

    const fullDerivationPath = [
      KeyDerivationScheme.ProtocolContext,
      firstContextSegment
    ];

    return fullDerivationPath;
  }

  /**
   * Constructs the full key derivation path using `schemas` scheme.
   */
  public static constructKeyDerivationPathUsingSchemasScheme( schema: string | undefined ): string[] {
    if (schema === undefined) {
      throw new DwnError(
        DwnErrorCode.RecordsSchemasDerivationSchemeMissingSchema,
        'Unable to construct key derivation path using `schemas` scheme because `schema` is missing.'
      );
    }

    const fullDerivationPath = [
      KeyDerivationScheme.Schemas,
      schema
    ];

    return fullDerivationPath;
  }

  /**
   * Derives a descendant private key given an ancestor private key and the full absolute derivation path.
   * NOTE: right now only `ECIES-ES256K` algorithm is supported for asymmetric encryption,
   *       so we will only derive SECP256K1 key without additional conditional checks
   */
  public static async derivePrivateKey(ancestorPrivateKey: DerivedPrivateJwk, fullDescendantDerivationPath: string[]): Promise<Uint8Array> {
    if (ancestorPrivateKey.derivedPrivateKey.crv !== 'secp256k1') {
      throw new DwnError(
        DwnErrorCode.RecordsDerivePrivateKeyUnSupportedCurve,
        `Curve ${ancestorPrivateKey.derivedPrivateKey.crv} is not supported.`
      );
    }

    const ancestorPrivateKeyDerivationPath = ancestorPrivateKey.derivationPath ?? [];

    Records.validateAncestorKeyAndDescentKeyDerivationPathsMatch(ancestorPrivateKeyDerivationPath, fullDescendantDerivationPath);

    const subDerivationPath = fullDescendantDerivationPath.slice(ancestorPrivateKeyDerivationPath.length);
    const ancestorPrivateKeyBytes = Secp256k1.privateJwkToBytes(ancestorPrivateKey.derivedPrivateKey);
    const leafPrivateKey = await HdKey.derivePrivateKeyBytes(ancestorPrivateKeyBytes, subDerivationPath);

    return leafPrivateKey;
  }

  /**
   * Validates that ancestor derivation path matches the descendant derivation path completely.
   * @throws {DwnError} with `DwnErrorCode.RecordsInvalidAncestorKeyDerivationSegment` if fails validation.
   */
  public static validateAncestorKeyAndDescentKeyDerivationPathsMatch(
    ancestorKeyDerivationPath: string[],
    descendantKeyDerivationPath: string[]
  ): void {
    for (let i = 0; i < ancestorKeyDerivationPath.length; i++) {
      const ancestorSegment = ancestorKeyDerivationPath[i];
      const descendantSegment = descendantKeyDerivationPath[i];
      if (ancestorSegment !== descendantSegment) {
        throw new DwnError(
          DwnErrorCode.RecordsInvalidAncestorKeyDerivationSegment,
          `Ancestor key derivation segment '${ancestorSegment}' mismatches against the descendant key derivation segment '${descendantSegment}'.`);
      }
    }
  }

  /**
   * Extracts the parent context ID from the given context ID.
   */
  public static getParentContextFromOfContextId(contextId: string | undefined): string | undefined {
    if (contextId === undefined) {
      return undefined;
    }

    // NOTE: assumes the given contextId is a valid contextId in the form of `a/b/c/d`.
    // `/a/b/c/d` or `a/b/c/d/` is not supported.

    const lastIndex = contextId.lastIndexOf('/');

    // If '/' is not found, this means this is a root record, so return an empty string as the parent context ID.
    if (lastIndex === -1) {
      return '';
    } else {
      return contextId.substring(0, lastIndex);
    }
  }

  /**
   * Normalizes the protocol and schema URLs within a provided RecordsFilter and returns a copy of RecordsFilter with the modified values.
   *
   * @param filter incoming RecordsFilter to normalize.
   * @returns {RecordsFilter} a copy of the incoming RecordsFilter with the normalized properties.
   */
  public static normalizeFilter(filter: RecordsFilter): RecordsFilter {
    let protocol;
    if (filter.protocol === undefined) {
      protocol = undefined;
    } else {
      protocol = normalizeProtocolUrl(filter.protocol);
    }

    let schema;
    if (filter.schema === undefined) {
      schema = undefined;
    } else {
      schema = normalizeSchemaUrl(filter.schema);
    }

    const filterCopy = {
      ...filter,
      protocol,
      schema,
    };

    removeUndefinedProperties(filterCopy);
    return filterCopy;
  }


  public static isStartsWithFilter(filter: RecordsWriteTagsFilter): filter is StartsWithFilter {
    return typeof filter === 'object' && ('startsWith' in filter && typeof filter.startsWith === 'string');
  }

  /**
   * This will create individual keys for each of the tags that look like `tag.tag_property`
   */
  public static buildTagIndexes(tags: RecordsWriteTags): KeyValues {
    const tagValues:KeyValues = {};
    for (const property in tags) {
      const value = tags[property];
      tagValues[`tag.${property}`] = value;
    }
    return tagValues;
  }

  /**
   * This will create individual keys for each of the tag filters that look like `tag.tag_filter_property`
   */
  private static convertTagsFilter( tags: { [property: string]: RecordsWriteTagsFilter}): Filter {
    const tagValues:Filter = {};
    for (const property in tags) {
      const value = tags[property];
      tagValues[`tag.${property}`] = this.isStartsWithFilter(value) ? FilterUtility.constructPrefixFilterAsRangeFilter(value.startsWith) : value;
    }
    return tagValues;
  }

  /**
   *  Converts an incoming RecordsFilter into a Filter usable by MessageStore.
   *
   * @param filter A RecordsFilter
   * @returns {Filter} a generic Filter able to be used with MessageStore.
   */
  public static convertFilter(filter: RecordsFilter, dateSort?: DateSort): Filter {
    // we process tags separately from the remaining filters.
    // this is because we prepend each field within the `tags` object with a `tag.` to avoid name clashing with first-class index keys.
    // so `{ tags: { tag1: 'val1', tag2: [1,2] }}` would translate to `'tag.tag1':'val1'` and `'tag.tag2': [1,2]`
    const { tags, ...remainingFilter } = filter;
    let tagsFilter: Filter = {};
    if (tags !== undefined) {
      // this will namespace the tags so the properties are filtered as `tag.property_name`
      tagsFilter = { ...this.convertTagsFilter(tags) };
    }

    const filterCopy = { ...remainingFilter, ...tagsFilter } as Filter;

    // extract properties that needs conversion
    const { dateCreated, datePublished, dateUpdated, contextId } = filter;

    const dateCreatedFilter = dateCreated ? FilterUtility.convertRangeCriterion(dateCreated) : undefined;
    if (dateCreatedFilter) {
      filterCopy.dateCreated = dateCreatedFilter;
    }

    const datePublishedFilter = datePublished ? FilterUtility.convertRangeCriterion(datePublished): undefined;
    if (datePublishedFilter) {
      // only return published records when filtering with a datePublished range.
      filterCopy.published = true;
      filterCopy.datePublished = datePublishedFilter;
    }

    // if we sort by `PublishedAscending` or `PublishedDescending` we must filter for only published records.
    if (filterCopy.published !== true && (dateSort === DateSort.PublishedAscending || dateSort === DateSort.PublishedDescending)) {
      filterCopy.published = true;
    }

    const messageTimestampFilter = dateUpdated ? FilterUtility.convertRangeCriterion(dateUpdated) : undefined;
    if (messageTimestampFilter) {
      filterCopy.messageTimestamp = messageTimestampFilter;
      delete filterCopy.dateUpdated;
    }

    // contextId conversion to prefix match
    const contextIdPrefixFilter = contextId ? FilterUtility.constructPrefixFilterAsRangeFilter(contextId) : undefined;
    if (contextIdPrefixFilter) {
      filterCopy.contextId = contextIdPrefixFilter;
    }

    return filterCopy as Filter;
  }

  /**
   * Validates the referential integrity of both author-delegated grant and owner-delegated grant.
   * @param authorSignaturePayload Decoded payload of the author signature of the message. Pass `undefined` if message is not signed.
   *                               Passed purely as a performance optimization so we don't have to decode the signature payload again.
   * @param ownerSignaturePayload Decoded payload of the owner signature of the message. Pass `undefined` if no owner signature is present.
   *                              Passed purely as a performance optimization so we don't have to decode the owner signature payload again.
   */
  public static async validateDelegatedGrantReferentialIntegrity(
    message: RecordsReadMessage | RecordsQueryMessage | RecordsWriteMessage | RecordsDeleteMessage | RecordsSubscribeMessage,
    authorSignaturePayload: GenericSignaturePayload | undefined,
    ownerSignaturePayload?: GenericSignaturePayload | undefined
  ): Promise<void> {
    // `deletedGrantId` in the payload of the message signature and `authorDelegatedGrant` in `authorization` must both exist or be both undefined
    const authorDelegatedGrantIdDefined = authorSignaturePayload?.delegatedGrantId !== undefined;
    const authorDelegatedGrantDefined = message.authorization?.authorDelegatedGrant !== undefined;
    if (authorDelegatedGrantIdDefined !== authorDelegatedGrantDefined) {
      throw new DwnError(
        DwnErrorCode.RecordsAuthorDelegatedGrantAndIdExistenceMismatch,
        `delegatedGrantId in message (author) signature and authorDelegatedGrant must both exist or be undefined. \
         delegatedGrantId in message (author) signature defined: ${authorDelegatedGrantIdDefined}, \
         authorDelegatedGrant defined: ${authorDelegatedGrantDefined}`
      );
    }

    if (authorDelegatedGrantDefined) {
      const delegatedGrant = message.authorization!.authorDelegatedGrant!;

      const permissionGrant = await PermissionGrant.parse(delegatedGrant);
      if (permissionGrant.delegated !== true) {
        throw new DwnError(
          DwnErrorCode.RecordsAuthorDelegatedGrantNotADelegatedGrant,
          `The owner delegated grant given is not a delegated grant.`
        );
      }

      const grantedTo = delegatedGrant.descriptor.recipient;
      const signer = Message.getSigner(message);
      if (grantedTo !== signer) {
        throw new DwnError(
          DwnErrorCode.RecordsAuthorDelegatedGrantGrantedToAndOwnerSignatureMismatch,
          `grantedTo ${grantedTo} in author delegated grant must be the same as the signer ${signer} of the message signature.`
        );
      }

      const delegateGrantCid = await Message.getCid(delegatedGrant);
      if (delegateGrantCid !== authorSignaturePayload!.delegatedGrantId) {
        throw new DwnError(
          DwnErrorCode.RecordsAuthorDelegatedGrantCidMismatch,
          `CID of the author delegated grant ${delegateGrantCid} must be the same as \
          the delegatedGrantId ${authorSignaturePayload!.delegatedGrantId} in the message signature.`
        );
      }
    }

    // repeat the same checks for the owner signature below

    // `deletedGrantId` in the payload of the owner signature and `ownerDelegatedGrant` in `authorization` must both exist or be both undefined
    const ownerDelegatedGrantIdDefined = ownerSignaturePayload?.delegatedGrantId !== undefined;
    const ownerDelegatedGrantDefined = message.authorization?.ownerDelegatedGrant !== undefined;
    if (ownerDelegatedGrantIdDefined !== ownerDelegatedGrantDefined) {
      throw new DwnError(
        DwnErrorCode.RecordsOwnerDelegatedGrantAndIdExistenceMismatch,
        `delegatedGrantId in owner signature and ownerDelegatedGrant must both exist or be undefined. \
         delegatedGrantId in owner signature defined: ${ownerDelegatedGrantIdDefined}, \
         ownerDelegatedGrant defined: ${ownerDelegatedGrantDefined}`
      );
    }

    if (ownerDelegatedGrantDefined) {
      const delegatedGrant = message.authorization!.ownerDelegatedGrant!;
      const permissionGrant = await PermissionGrant.parse(delegatedGrant);

      if (permissionGrant.delegated !== true) {
        throw new DwnError(
          DwnErrorCode.RecordsOwnerDelegatedGrantNotADelegatedGrant,
          `The owner delegated grant given is not a delegated grant.`
        );
      }

      const grantedTo = delegatedGrant.descriptor.recipient;
      const signer = Jws.getSignerDid(message.authorization!.ownerSignature!.signatures[0]);
      if (grantedTo !== signer) {
        throw new DwnError(
          DwnErrorCode.RecordsOwnerDelegatedGrantGrantedToAndOwnerSignatureMismatch,
          `grantedTo ${grantedTo} in owner delegated grant must be the same as the signer ${signer} of the owner signature.`
        );
      }

      const delegateGrantCid = await Message.getCid(delegatedGrant);
      if (delegateGrantCid !== ownerSignaturePayload!.delegatedGrantId) {
        throw new DwnError(
          DwnErrorCode.RecordsOwnerDelegatedGrantCidMismatch,
          `CID of the owner delegated grant ${delegateGrantCid} must be the same as \
          the delegatedGrantId ${ownerSignaturePayload!.delegatedGrantId} in the owner signature.`
        );
      }
    }
  }

  /**
   * Determines if signature payload contains a protocolRole and should be authorized as such.
   */
  static shouldProtocolAuthorize(signaturePayload: GenericSignaturePayload): boolean {
    return signaturePayload.protocolRole !== undefined;
  }

  /**
   * Checks if the filter supports returning published records.
   */
  static filterIncludesPublishedRecords(filter: RecordsFilter): boolean {
    // NOTE: published records should still be returned when `published` and `datePublished` range are both undefined.
    return filter.datePublished !== undefined || filter.published !== false;
  }

  /**
   * Checks if the filter supports returning unpublished records.
   */
  static filterIncludesUnpublishedRecords(filter: RecordsFilter): boolean {
    // When `published` and `datePublished` range are both undefined, unpublished records can be returned.
    if (filter.datePublished === undefined && filter.published === undefined) {
      return true;
    }
    return filter.published === false;
  }
}
