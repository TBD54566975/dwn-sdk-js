import * as crypto from 'crypto';
import secp256k1 from 'secp256k1';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

/**
 * Utility class for deriving keys based on TP17 (https://github.com/TBD54566975/technical-proposals/pull/4)
 */
export class HdKey {
  /**
   * Derives a hierarchical deterministic public key.
   * @param key Either a private or an uncompressed public key used to derive the descendant public key.
   * @param relativePath `/` delimited path relative to the key given. e.g. 'a/b/c'
   * @returns uncompressed public key
   */
  public static async derivePublicKey(key: Uint8Array, relativePath: string): Promise<Uint8Array> {
    const pathSegments = HdKey.parseAndValidateKeyDerivationPath(relativePath);

    let currentPublicKey: Uint8Array;
    if (key.length === 32) {
      // private key is always 32 bytes
      currentPublicKey = secp256k1.publicKeyCreate(key);
    } else {
      currentPublicKey = key;
    }

    for (const segment of pathSegments) {
      const hash = crypto.createHash('sha256').update(segment).digest();
      currentPublicKey = HdKey.deriveChildPublicKey(currentPublicKey, hash);
    }

    return currentPublicKey;
  }

  /**
   * Derives a hierarchical deterministic private key.
   * @param relativePath `/` delimited path relative to the key given. e.g. 'a/b/c'
   */
  public static async derivePrivateKey(privateKey: Uint8Array, relativePath: string): Promise<Uint8Array> {
    const pathSegments = HdKey.parseAndValidateKeyDerivationPath(relativePath);

    let currentPrivateKey = privateKey;
    for (const segment of pathSegments) {
      const hash = crypto.createHash('sha256').update(segment).digest();
      currentPrivateKey = HdKey.deriveChildPrivateKey(currentPrivateKey, hash);
    }

    return currentPrivateKey;
  }

  /**
   * Derives a child public key using the given tweak input.
   */
  public static deriveChildPublicKey(uncompressedPublicKey: Uint8Array, tweakInput: Uint8Array): Uint8Array {
    const compressedPublicKey = false;
    const derivedPublicKey = secp256k1.publicKeyTweakAdd(uncompressedPublicKey, tweakInput, compressedPublicKey);
    return derivedPublicKey;
  }

  /**
   * Derives a child private key using the given tweak input.
   */
  public static deriveChildPrivateKey(privateKey: Uint8Array, tweakInput: Uint8Array): Uint8Array {
    // NOTE: passing in private key to v5.0.0 of `secp256k1.privateKeyTweakAdd()` has the side effect of morphing the input private key bytes
    // before there is a fix for it (we can also investigate and submit a PR), we clone the private key to workaround
    // `secp256k1.publicKeyTweakAdd()` does not have this side effect
    const privateKeyClone = new Uint8Array(privateKey.length);
    privateKeyClone.set(privateKey);

    const derivedPrivateKey = secp256k1.privateKeyTweakAdd(privateKeyClone, tweakInput);
    return derivedPrivateKey;
  }

  /**
   * Parses the given key derivation path.
   * @returns Path segments if successfully validate the derivation path.
   * @throws {DwnError} with `DwnErrorCode.HdKeyDerivationPathInvalid` if derivation path fails validation.
   */
  private static parseAndValidateKeyDerivationPath(derivationPath: string): string[] {
    const pathSegments = derivationPath.split('/');

    if (pathSegments.length === 0 || pathSegments.includes('')) {
      throw new DwnError(DwnErrorCode.HdKeyDerivationPathInvalid, `Invalid key derivation path: ${derivationPath}`);
    }

    return pathSegments;
  }
}