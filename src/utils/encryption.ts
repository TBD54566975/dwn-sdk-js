import * as crypto from 'crypto';
import * as eccrypto from 'eccrypto';
import { Readable } from 'readable-stream';

/**
 * Utility class for performing common encryption operations.
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
   * Encrypts the given plaintext using ECIES (Elliptic Curve Integrated Encryption Scheme) with SECP256K1.
   */
  public static async eciesSecp256k1Encrypt(uncompressedPublicKey: Uint8Array, plaintext: Uint8Array): Promise<EciesEncryptionOutput> {
    // TODO: #291 - Swap out `eccrypto` in favor of a more up-to-date ECIES library - https://github.com/TBD54566975/dwn-sdk-js/issues/291
    const publicKey = Buffer.from(uncompressedPublicKey);

    const { ciphertext, ephemPublicKey, iv, mac } = await eccrypto.encrypt(publicKey, plaintext as Buffer);

    return {
      ciphertext,
      ephemeralPublicKey        : ephemPublicKey,
      initializationVector      : iv,
      messageAuthenticationCode : mac
    };
  }

  /**
   * Decrypt the given plaintext using ECIES (Elliptic Curve Integrated Encryption Scheme) with SECP256K1.
   */
  public static async eciesSecp256k1Decrypt(input: EciesEncryptionInput): Promise<Uint8Array> {
    // underlying library requires Buffer as input
    // TODO: #291 - Swap out `eccrypto` in favor of a more up-to-date ECIES library - https://github.com/TBD54566975/dwn-sdk-js/issues/291
    const privateKeyBuffer = Buffer.from(input.privateKey);
    const ephemPublicKey = Buffer.from(input.ephemeralPublicKey);
    const eciesEncryptionOutput = {
      ciphertext : input.ciphertext as Buffer,
      ephemPublicKey,
      iv         : input.initializationVector as Buffer,
      mac        : input.messageAuthenticationCode as Buffer
    };

    const plaintext = await eccrypto.decrypt(privateKeyBuffer, eciesEncryptionOutput);

    return plaintext;
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