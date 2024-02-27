import { p256 } from "@noble/curves/p256";
import type { PublicJwk } from "../types/jose-types.js";
import { sha256 } from "multiformats/hashes/sha2";
import { fromString, toString } from "uint8arrays";

type PlaceholderPublicJwk = any;
type PlaceholderPrivateJwk = any;
const u8a = { toString, fromString };

export class Secp256r1 {
  /**
   * Verifies a signature against the provided payload hash and public key.
   * @returns a boolean indicating whether the signature is valid.
   */
  public static async verify(
    content: Uint8Array,
    signature: Uint8Array,
    publicJwk: PublicJwk
  ): Promise<boolean> {
    const sig = p256.Signature.fromDER(signature);
    const hashedContent = await sha256.encode(content);
    const keyBytes = p256.ProjectivePoint.fromAffine({
      x: Secp256r1.bytesToBigInt(Secp256r1.base64ToBytes(publicJwk.x)),
      y: Secp256r1.bytesToBigInt(Secp256r1.base64ToBytes(publicJwk.y!)),
    }).toRawBytes(false);

    try {
      return p256.verify(sig, hashedContent, keyBytes);
    } catch (err) {
      return false;
    }
  }

  public static async sign(
    content: Uint8Array,
    privateJwk: PlaceholderPrivateJwk
  ): Promise<Uint8Array> {
    // Placeholder implementation
    return new Promise((resolve, reject) => {
      // For now, just resolve with an empty Uint8Array
      resolve(new Uint8Array());
    });
  }

  public static async generateKeyPair(): Promise<{
    publicJwk: PlaceholderPublicJwk;
    privateJwk: PlaceholderPrivateJwk;
  }> {
    // Placeholder implementation
    return new Promise((resolve, reject) => {
      // For now, just resolve with an object with empty publicJwk and privateJwk
      resolve({ publicJwk: {}, privateJwk: {} });
    });
  }

  public static async publicKeyToJwk(
    publicKeyBytes: Uint8Array
  ): Promise<PlaceholderPublicJwk> {
    // Placeholder implementation
    return new Promise((resolve, reject) => {
      // For now, just resolve with an empty PublicJwk
      resolve({});
    });
  }

  public static base64ToBytes(s: string): Uint8Array {
    const inputBase64Url = s
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    return u8a.fromString(inputBase64Url, "base64url");
  }

  public static bytesToBigInt(b: Uint8Array): bigint {
    return BigInt(`0x` + u8a.toString(b, "base16"));
  }
}
