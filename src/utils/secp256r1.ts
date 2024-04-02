import type { PrivateJwk, PublicJwk } from '../types/jose-types.js';

import { p256, secp256r1 } from '@noble/curves/p256';

import { Encoder } from './encoder.js';
import { sha256 } from 'multiformats/hashes/sha2';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { fromString, toString } from 'uint8arrays';

const u8a = { toString, fromString };

/**
 * Class containing SECP256R1 related utility methods.
 */
export class Secp256r1 {
  /**
   * Validates the given JWK is a SECP256R1 key.
   * @throws {Error} if fails validation.
   */
  public static validateKey(jwk: PrivateJwk | PublicJwk): void {
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
      throw new DwnError(
        DwnErrorCode.Secp256r1KeyNotValid,
        'Invalid SECP256R1 JWK: `kty` MUST be `EC`. `crv` MUST be `P-256`'
      );
    }
  }

  /**
   * Converts a public key in bytes into a JWK.
   */
  public static async publicKeyToJwk(
    publicKeyBytes: Uint8Array
  ): Promise<PublicJwk> {
    // ensure public key is in uncompressed format so we can convert it into both x and y value
    let uncompressedPublicKeyBytes;
    if (publicKeyBytes.byteLength === 33) {
      // this means given key is compressed
      const curvePoints = p256.ProjectivePoint.fromHex(publicKeyBytes);
      uncompressedPublicKeyBytes = curvePoints.toRawBytes(false); // isCompressed = false
    } else {
      uncompressedPublicKeyBytes = publicKeyBytes;
    }

    // the first byte is a header that indicates whether the key is uncompressed (0x04 if uncompressed), we can safely ignore
    // bytes 1 - 32 represent X
    // bytes 33 - 64 represent Y

    // skip the first byte because it's used as a header to indicate whether the key is uncompressed
    const x = Encoder.bytesToBase64Url(
      uncompressedPublicKeyBytes.subarray(1, 33)
    );
    const y = Encoder.bytesToBase64Url(
      uncompressedPublicKeyBytes.subarray(33, 65)
    );

    const publicJwk: PublicJwk = {
      alg : 'ES256',
      kty : 'EC',
      crv : 'P-256',
      x,
      y,
    };

    return publicJwk;
  }

  /**
   * Creates a private key in raw bytes from the given SECP256R1 JWK.
   */
  public static privateJwkToBytes(privateJwk: PrivateJwk): Uint8Array {
    const privateKey = Encoder.base64UrlToBytes(privateJwk.d);
    return privateKey;
  }

  /**
   * Signs the provided content using the provided JWK.
   * Signature that is outputted is JWS format, not DER.
   */
  public static async sign(
    content: Uint8Array,
    privateJwk: PrivateJwk
  ): Promise<Uint8Array> {
    Secp256r1.validateKey(privateJwk);

    const hashedContent = await sha256.encode(content);
    const privateKeyBytes = Secp256r1.privateJwkToBytes(privateJwk);

    return Promise.resolve(
      p256.sign(hashedContent, privateKeyBytes).toCompactRawBytes()
    );
  }

  /**
   * Verifies a signature against the provided payload hash and public key.
   * @param signature - the signature to verify. Can be in either DER or compact format. If using Oracle Cloud KMS, keys will be DER formatted.
   * @returns a boolean indicating whether the signature is valid.
   */
  public static async verify(
    content: Uint8Array,
    signature: Uint8Array,
    publicJwk: PublicJwk
  ): Promise<boolean> {
    Secp256r1.validateKey(publicJwk);

    // handle DER vs compact signature formats
    let sig;
    if (signature.length === 64) {
      sig = p256.Signature.fromCompact(signature);
    } else {
      sig = p256.Signature.fromDER(signature);
    }
    const hashedContent = await sha256.encode(content);
    const keyBytes = p256.ProjectivePoint.fromAffine({
      x : Secp256r1.bytesToBigInt(Encoder.base64UrlToBytes(publicJwk.x)),
      y : Secp256r1.bytesToBigInt(Encoder.base64UrlToBytes(publicJwk.y!)),
    }).toRawBytes(false);

    return p256.verify(sig, hashedContent, keyBytes);
  }

  /**
   * Generates a random key pair in JWK format.
   */
  public static async generateKeyPair(): Promise<{
    publicJwk: PublicJwk;
    privateJwk: PrivateJwk;
  }> {
    const privateKeyBytes = p256.utils.randomPrivateKey();
    const publicKeyBytes = secp256r1.getPublicKey(privateKeyBytes, false); // `false` = uncompressed

    const d = Encoder.bytesToBase64Url(privateKeyBytes);
    const publicJwk: PublicJwk = await Secp256r1.publicKeyToJwk(publicKeyBytes);
    const privateJwk: PrivateJwk = { ...publicJwk, d };

    return { publicJwk, privateJwk };
  }

  public static bytesToBigInt(b: Uint8Array): bigint {
    return BigInt(`0x` + u8a.toString(b, 'base16'));
  }
}
