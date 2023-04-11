import type { Readable } from 'readable-stream';
import type { UnsignedRecordsWriteMessage } from '../interfaces/records/types.js';
import type { DerivedPrivateJwk, DerivedPublicJwk } from './hd-key.js';

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
   */
  public static async decrypt(
    recordsWrite: UnsignedRecordsWriteMessage,
    ancestorPrivateKey: DerivedPrivateJwk,
    cipherStream: Readable
  ): Promise<Readable> {
    const { encryption, contextId, descriptor } = recordsWrite;

    // look for an encrypted symmetric key that is encrypted using the same scheme as the given derived private key
    const matchingEncryptedKey = encryption!.keyEncryption.find(key => key.derivationScheme === ancestorPrivateKey.derivationScheme);
    if (matchingEncryptedKey === undefined) {
      throw new DwnError(
        DwnErrorCode.RecordsDecryptNoMatchingKeyDerivationScheme,
        `Unable to find symmetric key encrypted using '${ancestorPrivateKey.derivationScheme}' derivation scheme.`
      );
    }

    // NOTE: right now only `protocol-context` scheme is supported so we will assume that's the scheme without additional switch/if statements
    // derive the leaf private key
    const leafDerivationPath = [KeyDerivationScheme.ProtocolContext, descriptor.protocol!, contextId!];

    // NOTE: right now only `ECIES-ES256K` algorithm is supported for asymmetric encryption,
    // so we will assume that's the algorithm without additional switch/if statements
    const leafPrivateKey = await Records.deriveLeafPrivateKey(ancestorPrivateKey, leafDerivationPath);
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
   * Derives a descendant public key given an ancestor public key.
   * NOTE: right now only `ECIES-ES256K` algorithm is supported for asymmetric encryption,
   *       so we will assume that's the algorithm without additional switch/if statements
   */
  public static async deriveLeafPublicKey(ancestorPublicKey: DerivedPublicJwk, fullDescendantDerivationPath: string[]): Promise<Uint8Array> {
    if (ancestorPublicKey.derivedPublicKey.crv !== 'secp256k1') {
      throw new DwnError(
        DwnErrorCode.RecordsDeriveLeafPublicKeyUnSupportedCurve,
        `Curve ${ancestorPublicKey.derivedPublicKey.crv} is not supported.`
      );
    }

    Records.validateAncestorKeyAndDescentKeyDerivationPathsMatch(ancestorPublicKey.derivationPath, fullDescendantDerivationPath);

    const subDerivationPath = fullDescendantDerivationPath.slice(ancestorPublicKey.derivationPath.length);
    const ancestorPublicKeyBytes = Secp256k1.publicJwkToBytes(ancestorPublicKey.derivedPublicKey);
    const leafPublicKey = await Secp256k1.derivePublicKey(ancestorPublicKeyBytes, subDerivationPath);

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

    Records.validateAncestorKeyAndDescentKeyDerivationPathsMatch(ancestorPrivateKey.derivationPath, fullDescendantDerivationPath);

    const subDerivationPath = fullDescendantDerivationPath.slice(ancestorPrivateKey.derivationPath.length);
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
