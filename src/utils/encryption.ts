import * as eciesjs from 'eciesjs';
import { AesCtr } from '@web5/crypto';
import type { Jwk } from '@web5/crypto';
import { Readable } from 'readable-stream';

// compress publicKey for message encryption
eciesjs.ECIES_CONFIG.isEphemeralKeyCompressed = true;

/**
 * Utility class for performing common, non-DWN specific encryption operations.
 */
export class Encryption {
  /**
   * Encrypts the given plaintext stream using AES-256-CTR algorithm.
   */

  private static async convertToJwk(key: Uint8Array): Promise<Jwk> {
    return {
      kty : 'oct',
      k   : Buffer.from(key).toString('base64url'),
      alg : 'A256CTR',
      ext : 'true',
    };
  }

  public static async aes256CtrEncrypt(
    key: Uint8Array,
    initializationVector: Uint8Array,
    plaintextStream: Readable
  ): Promise<Readable> {
    const jwkKey = await this.convertToJwk(key);

    // Create a cipher stream
    const cipherStream = new Readable({
      read(): void {},
    });

    plaintextStream.on('data', async (chunk) => {
      // Encrypt the chunk using AesCtr
      const encryptedChunk = await AesCtr.encrypt({
        data    : chunk,
        key     : jwkKey,
        counter : initializationVector,
        length  : 256,
      });

      cipherStream.push(encryptedChunk);
    });

    plaintextStream.on('end', () => {
      cipherStream.push(null); // Signal the end of the stream
    });

    plaintextStream.on('error', (err) => {
      cipherStream.emit('error', err); // Emit error if any occurs in the plaintext stream
    });

    return cipherStream; // Return the cipher stream
  }

  /**
   * Decrypts the given cipher stream using AES-256-CTR algorithm.
   */
  public static async aes256CtrDecrypt(
    key: Uint8Array,
    initializationVector: Uint8Array,
    cipherStream: Readable
  ): Promise<Readable> {
    const jwkKey = await this.convertToJwk(key); // Convert key to JWK format

    // Create a plaintext stream
    const plaintextStream = new Readable({
      read(): void {},
    });

    cipherStream.on('data', async (chunk) => {
      // Decrypt the chunk using AesCtr
      const decryptedChunk = await AesCtr.decrypt({
        data    : chunk,
        key     : jwkKey,
        counter : initializationVector,
        length  : 256, // Length of the key in bits
      });

      plaintextStream.push(decryptedChunk); // Push the decrypted chunk to the plaintext stream
    });

    cipherStream.on('end', () => {
      plaintextStream.push(null); // Signal the end of the stream
    });

    cipherStream.on('error', (err) => {
      plaintextStream.emit('error', err); // Emit error if any occurs in the cipher stream
    });

    return plaintextStream; // Return the plaintext stream
  }

  /**
   * Encrypts the given plaintext using ECIES (Elliptic Curve Integrated Encryption Scheme)
   * with SECP256K1 for the asymmetric calculations, HKDF as the key-derivation function,
   * and AES-GCM for the symmetric encryption and MAC algorithms.
   */
  public static async eciesSecp256k1Encrypt(
    publicKeyBytes: Uint8Array,
    plaintext: Uint8Array
  ): Promise<EciesEncryptionOutput> {
    // underlying library requires Buffer as input
    const publicKey = Buffer.from(publicKeyBytes);
    const plaintextBuffer = Buffer.from(plaintext);

    const cryptogram = eciesjs.encrypt(publicKey, plaintextBuffer);

    // split cryptogram returned into constituent parts
    let start = 0;
    let end = Encryption.isEphemeralKeyCompressed ? 33 : 65;
    const ephemeralPublicKey = cryptogram.subarray(start, end);

    start = end;
    end += eciesjs.ECIES_CONFIG.symmetricNonceLength;
    const initializationVector = cryptogram.subarray(start, end);

    start = end;
    end += 16; // eciesjs.consts.AEAD_TAG_LENGTH
    const messageAuthenticationCode = cryptogram.subarray(start, end);

    const ciphertext = cryptogram.subarray(end);

    return {
      ciphertext,
      ephemeralPublicKey,
      initializationVector,
      messageAuthenticationCode,
    };
  }

  /**
   * Decrypt the given plaintext using ECIES (Elliptic Curve Integrated Encryption Scheme)
   * with SECP256K1 for the asymmetric calculations, HKDF as the key-derivation function,
   * and AES-GCM for the symmetric encryption and MAC algorithms.
   */
  public static async eciesSecp256k1Decrypt(
    input: EciesEncryptionInput
  ): Promise<Uint8Array> {
    // underlying library requires Buffer as input
    const privateKeyBuffer = Buffer.from(input.privateKey);
    const eciesEncryptionOutput = Buffer.concat([
      input.ephemeralPublicKey,
      input.initializationVector,
      input.messageAuthenticationCode,
      input.ciphertext,
    ]);

    const plaintext = eciesjs.decrypt(privateKeyBuffer, eciesEncryptionOutput);

    return plaintext;
  }

  /**
   * Expose eciesjs library configuration
   */
  static get isEphemeralKeyCompressed(): boolean {
    return eciesjs.ECIES_CONFIG.isEphemeralKeyCompressed;
  }
}

export type EciesEncryptionOutput = {
  initializationVector: Uint8Array;
  ephemeralPublicKey: Uint8Array;
  ciphertext: Uint8Array;
  messageAuthenticationCode: Uint8Array;
};

export type EciesEncryptionInput = EciesEncryptionOutput & {
  privateKey: Uint8Array;
};

export enum EncryptionAlgorithm {
  Aes256Ctr = 'A256CTR',
  EciesSecp256k1 = 'ECIES-ES256K',
}
