import type { DerivedPrivateJwk } from './hd-key.js';
import type { PublicJwk } from '../types/jose-types.js';
import type { Readable } from 'readable-stream';
import type { RecordsWriteDescriptor, UnsignedRecordsWriteMessage } from '../types/records-types.js';

import { Encoder } from './encoder.js';
import { Encryption } from './encryption.js';
import { KeyDerivationScheme } from './hd-key.js';
import { Secp256k1 } from './secp256k1.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

/**
 * Class containing useful utilities related to the Records interface.
 */
export class Records {
  /**
   * Decrypts the encrypted data in a message reply using the given ancestor private key.
   * @param ancestorPrivateKey Any ancestor private key in the key derivation path.
   */
  public static async decrypt(
    recordsWrite: UnsignedRecordsWriteMessage,
    ancestorPrivateKey: DerivedPrivateJwk,
    cipherStream: Readable
  ): Promise<Readable> {
    const { recordId, contextId, descriptor, encryption } = recordsWrite;

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

    const fullDerivationPath = Records.constructKeyDerivationPath(matchingEncryptedKey.derivationScheme, recordId, contextId, descriptor);

    // NOTE: right now only `ECIES-ES256K` algorithm is supported for asymmetric encryption,
    // so we will assume that's the algorithm without additional switch/if statements
    const leafPrivateKey = await Records.deriveLeafPrivateKey(ancestorPrivateKey, fullDerivationPath);
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
    recordId: string,
    contextId: string | undefined,
    descriptor: RecordsWriteDescriptor
  ): string[] {

    let fullDerivationPath;
    if (keyDerivationScheme === KeyDerivationScheme.DataFormats) {
      fullDerivationPath = Records.constructKeyDerivationPathUsingDataFormatsScheme(descriptor);
    } else if (keyDerivationScheme === KeyDerivationScheme.Protocols) {
      fullDerivationPath = Records.constructKeyDerivationPathUsingProtocolsScheme(recordId, contextId, descriptor);
    } else {
      // `schemas` scheme
      fullDerivationPath = Records.constructKeyDerivationPathUsingSchemasScheme(descriptor);
    }

    return fullDerivationPath;
  }

  /**
   * Constructs the full key derivation path using `dataFormats` scheme.
   */
  public static constructKeyDerivationPathUsingDataFormatsScheme(
    descriptor: RecordsWriteDescriptor
  ): string[] {
    if (descriptor.schema !== undefined) {
      return [
        KeyDerivationScheme.DataFormats,
        descriptor.schema, // this is as spec-ed on TP27, the intent is to support sharing the key for just a specific data type under a schema
        descriptor.dataFormat
      ];
    } else {
      return [
        KeyDerivationScheme.DataFormats,
        descriptor.dataFormat
      ];
    }
  }

  /**
   * Constructs the full key derivation path using `protocols` scheme.
   */
  private static constructKeyDerivationPathUsingProtocolsScheme(
    recordId: string,
    contextId: string | undefined,
    descriptor: RecordsWriteDescriptor
  ): string[] {
    // ensure `protocol` is defined
    // NOTE: no need to check `protocolPath` and `contextId` because earlier code ensures that if `protocol` is defined, those are defined also
    if (descriptor.protocol === undefined) {
      throw new DwnError(
        DwnErrorCode.RecordsProtocolsDerivationSchemeMissingProtocol,
        'Unable to construct key derivation path using `protocols` scheme because `protocol` is missing.'
      );
    }

    const protocolPathSegments = descriptor.protocolPath!.split('/');
    const fullDerivationPath = [
      KeyDerivationScheme.Protocols,
      descriptor.protocol,
      contextId!,
      ...protocolPathSegments,
      descriptor.dataFormat,
      recordId
    ];

    return fullDerivationPath;
  }

  /**
   * Constructs the full key derivation path using `schemas` scheme.
   */
  public static constructKeyDerivationPathUsingSchemasScheme(
    descriptor: RecordsWriteDescriptor
  ): string[] {
    if (descriptor.schema === undefined) {
      throw new DwnError(
        DwnErrorCode.RecordsSchemasDerivationSchemeMissingSchema,
        'Unable to construct key derivation path using `schemas` scheme because `schema` is missing.'
      );
    }

    const fullDerivationPath = [
      KeyDerivationScheme.Schemas,
      descriptor.schema
    ];

    return fullDerivationPath;
  }

  /**
   * Derives a descendant public key given an ancestor public key.
   * NOTE: right now only `ECIES-ES256K` algorithm is supported for asymmetric encryption,
   *       so we will assume that's the algorithm without additional switch/if statements
   */
  public static async deriveLeafPublicKey(rootPublicKey: PublicJwk, fullDescendantDerivationPath: string[]): Promise<Uint8Array> {
    if (rootPublicKey.crv !== 'secp256k1') {
      throw new DwnError(
        DwnErrorCode.RecordsDeriveLeafPublicKeyUnSupportedCurve,
        `Curve ${rootPublicKey.crv} is not supported.`
      );
    }

    const ancestorPublicKeyBytes = Secp256k1.publicJwkToBytes(rootPublicKey);
    const leafPublicKey = await Secp256k1.derivePublicKey(ancestorPublicKeyBytes, fullDescendantDerivationPath);

    return leafPublicKey;
  }

  /**
   * Derives a descendant private key given an ancestor private key.
   * NOTE: right now only `ECIES-ES256K` algorithm is supported for asymmetric encryption,
   *       so we will assume that's the algorithm without additional switch/if statements
   */
  public static async deriveLeafPrivateKey(ancestorPrivateKey: DerivedPrivateJwk, fullDescendantDerivationPath: string[]): Promise<Uint8Array> {
    if (ancestorPrivateKey.derivedPrivateKey.crv !== 'secp256k1') {
      throw new DwnError(
        DwnErrorCode.RecordsDeriveLeafPrivateKeyUnSupportedCurve,
        `Curve ${ancestorPrivateKey.derivedPrivateKey.crv} is not supported.`
      );
    }

    const ancestorPrivateKeyDerivationPath = ancestorPrivateKey.derivationPath ?? [];

    Records.validateAncestorKeyAndDescentKeyDerivationPathsMatch(ancestorPrivateKeyDerivationPath, fullDescendantDerivationPath);

    const subDerivationPath = fullDescendantDerivationPath.slice(ancestorPrivateKeyDerivationPath.length);
    const ancestorPrivateKeyBytes = Secp256k1.privateJwkToBytes(ancestorPrivateKey.derivedPrivateKey);
    const leafPrivateKey = await Secp256k1.derivePrivateKey(ancestorPrivateKeyBytes, subDerivationPath);

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
}
