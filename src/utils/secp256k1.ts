import type { PrivateJwk, PublicJwk } from '../types/jose-types.js';

import * as secp256k1 from '@noble/secp256k1';

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
      const publicKeyHex = secp256k1.etc.bytesToHex(publicKeyBytes);
      const curvePoints = secp256k1.ProjectivePoint.fromHex(publicKeyHex);
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
   * Creates a compressed key in raw bytes from the given SECP256K1 JWK.
   */
  public static publicJwkToBytes(publicJwk: PublicJwk): Uint8Array {
    const x = Encoder.base64UrlToBytes(publicJwk.x);
    const y = Encoder.base64UrlToBytes(publicJwk.y!);

    return secp256k1.ProjectivePoint.fromAffine({
      x : secp256k1.etc.bytesToNumberBE(x),
      y : secp256k1.etc.bytesToNumberBE(y)
    }).toRawBytes(true);
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
    const hashedContentHex = secp256k1.etc.bytesToHex(hashedContent);
    const privateKeyBytes = Secp256k1.privateJwkToBytes(privateJwk);
    const privateKeyHex = secp256k1.etc.bytesToHex(privateKeyBytes);

    return (await secp256k1.signAsync(hashedContentHex, privateKeyHex, )).toCompactRawBytes();
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
    const publicKeyBytes = secp256k1.getPublicKey(privateKeyBytes, false); // `false` = uncompressed

    const d = Encoder.bytesToBase64Url(privateKeyBytes);
    const publicJwk: PublicJwk = await Secp256k1.publicKeyToJwk(publicKeyBytes);
    const privateJwk: PrivateJwk = { ...publicJwk, d };

    return { publicJwk, privateJwk };
  }

  /**
   * Generates key pair in raw bytes, where the `publicKey` is compressed.
   */
  public static async generateKeyPairRaw(): Promise<{publicKey: Uint8Array, privateKey: Uint8Array}> {
    const privateKey = secp256k1.utils.randomPrivateKey();
    const publicKey = secp256k1.getPublicKey(privateKey, true); // `true` = compressed

    return { publicKey, privateKey };
  }

  /**
   * Gets the compressed public key of the given private key.
   */
  public static async getPublicKey(privateKey: Uint8Array): Promise<Uint8Array> {
    const publicKey = secp256k1.getPublicKey(privateKey, true); // `true` = compressed
    return publicKey;
  }

  /**
   * Gets the public JWK of the given private JWK.
   */
  public static async getPublicJwk(privateKeyJwk: PrivateJwk): Promise<PublicJwk> {
    // strip away `d`
    const { d: _d, ...publicKey } = privateKeyJwk;
    return publicKey;
  }

  /**
   * Derives a hardened hierarchical deterministic public key.
   * @returns uncompressed public key
   */
  public static async derivePublicKey(privateKey: Uint8Array, relativePath: string[]): Promise<Uint8Array> {
    Secp256k1.validateKeyDerivationPath(relativePath);

    // derive the private key first then compute the derived public key from the derive private key
    const derivedPrivateKey = await Secp256k1.derivePrivateKey(privateKey, relativePath);
    const derivedPublicKey = await Secp256k1.getPublicKey(derivedPrivateKey);
    return derivedPublicKey;
  }

  /**
   * Derives a hardened hierarchical deterministic private key.
   */
  public static async derivePrivateKey(privateKey: Uint8Array, relativePath: string[]): Promise<Uint8Array> {
    Secp256k1.validateKeyDerivationPath(relativePath);

    let currentPrivateKey = privateKey;
    for (const segment of relativePath) {
      const derivationSegment = Encoder.stringToBytes(segment);
      currentPrivateKey = await Secp256k1.deriveChildPrivateKey(currentPrivateKey, derivationSegment);
    }

    return currentPrivateKey;
  }

  /**
   * Derives a child private key using the given derivation path segment.
   */
  public static async deriveChildPrivateKey(privateKey: Uint8Array, derivationPathSegment: Uint8Array): Promise<Uint8Array> {
    // hash the private key & derivation segment
    const privateKeyHash = await sha256.encode(privateKey);
    const derivationPathSegmentHash = await sha256.encode(derivationPathSegment);
    const combinedBytes = secp256k1.etc.concatBytes(privateKeyHash, derivationPathSegmentHash);
    const derivedPrivateKey = secp256k1.etc.hashToPrivateKey(combinedBytes);
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
