import * as crypto from 'crypto';
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
}
