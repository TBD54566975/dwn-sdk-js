import * as crypto from 'crypto';
import * as eciesjs from 'eciesjs';
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
  public static async aes256CtrEncrypt(key: Uint8Array, initializationVector: Uint8Array, plaintextStream: Readable): Promise<Readable> {
    const cipher = crypto.createCipheriv('aes-256-ctr', key, initializationVector);

    const cipherStream = new Readable({
      read(): void { }
    });

    plaintextStream.on('data', (chunk) => {
      const encryptedChunk = cipher.update(chunk);
      cipherStream.push(encryptedChunk);
    });

    plaintextStream.on('end', () => {
      const finalChunk = cipher.final();
      cipherStream.push(finalChunk);
      cipherStream.push(null);
    });

    plaintextStream.on('error', (err) => {
      cipherStream.emit('error', err);
    });

    return cipherStream;
  }

  /**
   * Decrypts the given cipher stream using AES-256-CTR algorithm.
   */
  public static async aes256CtrDecrypt(key: Uint8Array, initializationVector: Uint8Array, cipherStream: Readable): Promise<Readable> {
    const decipher = crypto.createDecipheriv('aes-256-ctr', key, initializationVector);

    const plaintextStream = new Readable({
      read(): void { }
    });

    cipherStream.on('data', (chunk) => {
      const decryptedChunk = decipher.update(chunk);
      plaintextStream.push(decryptedChunk);
    });

    cipherStream.on('end', () => {
      const finalChunk = decipher.final();
      plaintextStream.push(finalChunk);
      plaintextStream.push(null);
    });

    cipherStream.on('error', (err) => {
      plaintextStream.emit('error', err);
    });

    return plaintextStream;
  }

  /**
   * Encrypts the given plaintext using ECIES (Elliptic Curve Integrated Encryption Scheme)
   * with SECP256K1 for the asymmetric calculations, HKDF as the key-derivation function,
   * and AES-GCM for the symmetric encryption and MAC algorithms.
   */
  public static async eciesSecp256k1Encrypt(publicKeyBytes: Uint8Array, plaintext: Uint8Array): Promise<EciesEncryptionOutput> {
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
      messageAuthenticationCode
    };
  }

  /**
   * Decrypt the given plaintext using ECIES (Elliptic Curve Integrated Encryption Scheme)
   * with SECP256K1 for the asymmetric calculations, HKDF as the key-derivation function,
   * and AES-GCM for the symmetric encryption and MAC algorithms.
   */
  public static async eciesSecp256k1Decrypt(input: EciesEncryptionInput): Promise<Uint8Array> {
    // underlying library requires Buffer as input
    const privateKeyBuffer = Buffer.from(input.privateKey);
    const eciesEncryptionOutput = Buffer.concat([
      input.ephemeralPublicKey,
      input.initializationVector,
      input.messageAuthenticationCode,
      input.ciphertext
    ]);

    const plaintext = eciesjs.decrypt(privateKeyBuffer, eciesEncryptionOutput);

    return plaintext;
  }

  /**
   * Expose eciesjs library configuration
   */
  static get isEphemeralKeyCompressed():boolean {
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
  EciesSecp256k1 = 'ECIES-ES256K'
}