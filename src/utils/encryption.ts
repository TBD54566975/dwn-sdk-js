import * as eciesjs from 'eciesjs';
import { AesCtr } from '@web5/crypto';
import type { Jwk } from '@web5/crypto';
import { Readable } from 'readable-stream';

// Compress publicKey for message encryption
eciesjs.ECIES_CONFIG.isEphemeralKeyCompressed = true;

export type EciesEncryptionOutput = {
  ciphertext: Uint8Array;
  ephemeralPublicKey: Uint8Array;
  initializationVector: Uint8Array;
  messageAuthenticationCode: Uint8Array;
};

export type EciesEncryptionInput = {
  privateKey: Uint8Array;
  ephemeralPublicKey: Uint8Array;
  initializationVector: Uint8Array;
  messageAuthenticationCode: Uint8Array;
  ciphertext: Uint8Array;
};

/**
 * Utility class for performing common, non-DWN specific encryption operations.
 */
export class Encryption {

  /**
   * Encrypts the given plaintext stream using AES-256-CTR algorithm.
   */

  public static isEphemeralKeyCompressed: boolean = true; // Set default value

  private static toBase64Url(buffer: Buffer): string {
    return buffer.toString('base64') // Convert to base64
      .replace(/\+/g, '-') // Replace + with -
      .replace(/\//g, '_') // Replace / with _
      .replace(/=+$/, ''); // Remove any trailing '='
  }

  private static async convertToJwk(key: Uint8Array): Promise<Jwk> {
    return {
      kty : 'oct',
      k   : this.toBase64Url(Buffer.from(key)), // Use the new base64url method
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

    let buffer = Buffer.alloc(0);

    plaintextStream.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
    });

    plaintextStream.on('end', async () => {
      try {
        // Encrypt the entire buffer when the stream ends
        const encryptedData = await AesCtr.encrypt({
          data    : buffer,
          key     : jwkKey,
          counter : initializationVector,
          length  : 128, // FIX: Counter length must be between 1 and 128
        });

        cipherStream.push(encryptedData);
        cipherStream.push(null); // Signal the end of the stream
      } catch (error) {
        cipherStream.emit('error', error); // Emit error if encryption fails
      }
    });

    plaintextStream.on('error', (err) => {
      cipherStream.emit('error', err); // Propagate errors
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

    let buffer = Buffer.alloc(0);

    cipherStream.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
    });

    cipherStream.on('end', async () => {
      try {
        // Decrypt the entire buffer when the stream ends
        const decryptedData = await AesCtr.decrypt({
          data    : buffer,
          key     : jwkKey,
          counter : initializationVector,
          length  : 128, // FIX: Counter length must be between 1 and 128
        });

        plaintextStream.push(decryptedData);
        plaintextStream.push(null); // Signal the end of the stream
      } catch (error) {
        plaintextStream.emit('error', error); // Emit error if decryption fails
      }
    });

    cipherStream.on('error', (err) => {
      plaintextStream.emit('error', err); // Propagate errors
    });

    return plaintextStream; // Return the plaintext stream
  }

  public static async eciesSecp256k1Encrypt(
    publicKeyBytes: Uint8Array,
    plaintext: Uint8Array
  ): Promise<EciesEncryptionOutput> {
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
    const privateKeyBuffer = Buffer.from(input.privateKey);
    const eciesEncryptionOutput = Buffer.concat([
      input.ephemeralPublicKey,
      input.initializationVector,
      input.messageAuthenticationCode,
      input.ciphertext,
    ]);

    /**
   * Expose eciesjs library configuration
   */
    return eciesjs.decrypt(privateKeyBuffer, eciesEncryptionOutput);
  }
}


export enum EncryptionAlgorithm {
  Aes256Ctr = 'A256CTR',
  EciesSecp256k1 = 'ECIES-ES256K',
}