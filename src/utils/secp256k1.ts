import type { PrivateJwk, PublicJwk } from '../jose/types.js';

import * as secp256k1 from '@noble/secp256k1';
import secp256k1Derivation from 'secp256k1';

import { Encoder } from '../utils/encoder.js';
import { sha256 } from 'multiformats/hashes/sha2';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

/**
 * Class containing SECP256K1 related utility methods.
 */
export class Secp256k1 {
  /**
   * Validates the given JWK is a SECP256K1 key.
   * @throws {Error} if fails validation.
   */
  public static validateKey(jwk: PrivateJwk | PublicJwk): void {
    if (jwk.kty !== 'EC' || jwk.crv !== 'secp256k1') {
      throw new DwnError(DwnErrorCode.Secp256k1KeyNotValid, 'Invalid SECP256K1 JWK: `kty` MUST be `EC`. `crv` MUST be `secp256k1`');
    }
  }

  /**
   * Converts a public key in bytes into a JWK.
   */
  public static async publicKeyToJwk(publicKeyBytes: Uint8Array): Promise<PublicJwk> {
  // ensure public key is in uncompressed format so we can convert it into both x and y value
    let uncompressedPublicKeyBytes;
    if (publicKeyBytes.byteLength === 33) {
    // this means given key is compressed
      const publicKeyHex = secp256k1.utils.bytesToHex(publicKeyBytes);
      const curvePoints = secp256k1.Point.fromHex(publicKeyHex);
      uncompressedPublicKeyBytes = curvePoints.toRawBytes(false); // isCompressed = false
    } else {
      uncompressedPublicKeyBytes = publicKeyBytes;
    }

    // the first byte is a header that indicates whether the key is uncompressed (0x04 if uncompressed), we can safely ignore
    // bytes 1 - 32 represent X
    // bytes 33 - 64 represent Y

    // skip the first byte because it's used as a header to indicate whether the key is uncompressed
    const x = Encoder.bytesToBase64Url(uncompressedPublicKeyBytes.subarray(1, 33));
    const y = Encoder.bytesToBase64Url(uncompressedPublicKeyBytes.subarray(33, 65));

    const publicJwk: PublicJwk = {
      alg : 'ES256K',
      kty : 'EC',
      crv : 'secp256k1',
      x,
      y
    };

    return publicJwk;
  }

  /**
   * Converts a private key in bytes into a JWK.
   */
  public static async privateKeyToJwk(privateKeyBytes: Uint8Array): Promise<PrivateJwk> {
    const publicKeyBytes = await Secp256k1.getPublicKey(privateKeyBytes);

    const jwk = await Secp256k1.publicKeyToJwk(publicKeyBytes);
    (jwk as PrivateJwk).d = Encoder.bytesToBase64Url(privateKeyBytes);

    return jwk as PrivateJwk;
  }

  /**
   * Creates a uncompressed key in raw bytes from the given SECP256K1 JWK.
   */
  public static publicJwkToBytes(publicJwk: PublicJwk): Uint8Array {
    const x = Encoder.base64UrlToBytes(publicJwk.x);
    const y = Encoder.base64UrlToBytes(publicJwk.y!);

    // leading byte of 0x04 indicates that the public key is uncompressed
    const publicKey = new Uint8Array([0x04, ...x, ...y]);
    return publicKey;
  }

  /**
   * Creates a private key in raw bytes from the given SECP256K1 JWK.
   */
  public static privateJwkToBytes(privateJwk: PrivateJwk): Uint8Array {
    const privateKey = Encoder.base64UrlToBytes(privateJwk.d);
    return privateKey;
  }

  /**
   * Signs the provided content using the provided JWK.
   */
  public static async sign(content: Uint8Array, privateJwk: PrivateJwk): Promise<Uint8Array> {
    Secp256k1.validateKey(privateJwk);

    // the underlying lib expects us to hash the content ourselves:
    // https://github.com/paulmillr/noble-secp256k1/blob/97aa518b9c12563544ea87eba471b32ecf179916/index.ts#L1160
    const hashedContent = await sha256.encode(content);
    const privateKeyBytes = Secp256k1.privateJwkToBytes(privateJwk);

    return await secp256k1.sign(hashedContent, privateKeyBytes, { der: false });
  }

  /**
   * Verifies a signature against the provided payload hash and public key.
   * @returns a boolean indicating whether the signature is valid.
   */
  public static async verify(content: Uint8Array, signature: Uint8Array, publicJwk: PublicJwk): Promise<boolean> {
    Secp256k1.validateKey(publicJwk);

    const publicKeyBytes = Secp256k1.publicJwkToBytes(publicJwk);
    const hashedContent = await sha256.encode(content);
    return secp256k1.verify(signature, hashedContent, publicKeyBytes);
  }

  /**
   * Generates a random key pair in JWK format.
   */
  public static async generateKeyPair(): Promise<{publicJwk: PublicJwk, privateJwk: PrivateJwk}> {
    const privateKeyBytes = secp256k1.utils.randomPrivateKey();
    const publicKeyBytes = secp256k1.getPublicKey(privateKeyBytes);

    const d = Encoder.bytesToBase64Url(privateKeyBytes);
    const publicJwk: PublicJwk = await Secp256k1.publicKeyToJwk(publicKeyBytes);
    const privateJwk: PrivateJwk = { ...publicJwk, d };

    return { publicJwk, privateJwk };
  }

  /**
   * Generates key pair in raw bytes, where the `publicKey` is uncompressed.
   */
  public static async generateKeyPairRaw(): Promise<{publicKey: Uint8Array, privateKey: Uint8Array}> {
    const privateKey = secp256k1.utils.randomPrivateKey();
    const publicKey = secp256k1.getPublicKey(privateKey);

    return { publicKey, privateKey };
  }

  /**
   * Gets the uncompressed public key of the given private key.
   */
  public static async getPublicKey(privateKey: Uint8Array): Promise<Uint8Array> {
    const compressedPublicKey = false;
    const publicKey = secp256k1.getPublicKey(privateKey, compressedPublicKey);
    return publicKey;
  }

  /**
   * Derives a hierarchical deterministic public key.
   * @param key Either a private or an uncompressed public key used to derive the descendant public key.
   * @returns uncompressed public key
   */
  public static async derivePublicKey(key: Uint8Array, relativePath: string[]): Promise<Uint8Array> {
    Secp256k1.validateKeyDerivationPath(relativePath);

    let currentPublicKey: Uint8Array;
    if (key.length === 32) {
      // private key is always 32 bytes
      currentPublicKey = secp256k1.getPublicKey(key);
    } else {
      currentPublicKey = key;
    }

    for (const segment of relativePath) {
      const hash = await sha256.encode(Encoder.stringToBytes(segment));
      currentPublicKey = Secp256k1.deriveChildPublicKey(currentPublicKey, hash);
    }

    return currentPublicKey;
  }

  /**
   * Derives a hierarchical deterministic private key.
   */
  public static async derivePrivateKey(privateKey: Uint8Array, relativePath: string[]): Promise<Uint8Array> {
    Secp256k1.validateKeyDerivationPath(relativePath);

    let currentPrivateKey = privateKey;
    for (const segment of relativePath) {
      const hash = await sha256.encode(Encoder.stringToBytes(segment));
      currentPrivateKey = Secp256k1.deriveChildPrivateKey(currentPrivateKey, hash);
    }

    return currentPrivateKey;
  }

  /**
   * Derives a child public key using the given tweak input.
   */
  public static deriveChildPublicKey(uncompressedPublicKey: Uint8Array, tweakInput: Uint8Array): Uint8Array {
    // underlying library requires Buffer as input
    const compressedPublicKey = false;
    const publicKeyBuffer = Buffer.from(uncompressedPublicKey);
    const tweakBuffer = Buffer.from(tweakInput);
    const derivedPublicKey = secp256k1Derivation.publicKeyTweakAdd(publicKeyBuffer, tweakBuffer, compressedPublicKey);
    return derivedPublicKey;
  }

  /**
   * Derives a child private key using the given tweak input.
   */
  public static deriveChildPrivateKey(privateKey: Uint8Array, tweakInput: Uint8Array): Uint8Array {
    // NOTE: passing in private key to v5.0.0 of `secp256k1.privateKeyTweakAdd()` has the side effect of modifying the input private key bytes.
    // `secp256k1.publicKeyTweakAdd()` does not have this side effect.
    // before there is a fix for it (we can also investigate and submit a PR), cloning the private key to workaround is a MUST
    // also underlying library requires Buffer as input
    const privateKeyBuffer = Buffer.from(privateKey);
    const tweakBuffer = Buffer.from(tweakInput);
    const derivedPrivateKey = secp256k1Derivation.privateKeyTweakAdd(privateKeyBuffer, tweakBuffer);
    return derivedPrivateKey;
  }

  /**
   * Parses the given key derivation path.
   * @returns Path segments if successfully validate the derivation path.
   * @throws {DwnError} with `DwnErrorCode.HdKeyDerivationPathInvalid` if derivation path fails validation.
   */
  private static validateKeyDerivationPath(pathSegments: string[]): void {
    if (pathSegments.includes('')) {
      throw new DwnError(DwnErrorCode.HdKeyDerivationPathInvalid, `Invalid key derivation path: ${pathSegments}`);
    }
  }
}
