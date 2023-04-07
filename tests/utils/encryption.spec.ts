import { Comparer } from '../utils/comparer.js';
import { DataStream } from '../../src/index.js';
import { Encryption } from '../../src/utils/encryption.js';
import { expect } from 'chai';
import { Readable } from 'readable-stream';
import { Secp256k1 } from '../../src/utils/secp256k1.js';
import { TestDataGenerator } from './test-data-generator.js';

describe('Encryption', () => {
  describe('AES-256-CTR', () => {
    it('should be able to encrypt and decrypt a data stream correctly', async () => {
      const key = TestDataGenerator.randomBytes(32);
      const initializationVector = TestDataGenerator.randomBytes(16);

      const inputBytes = TestDataGenerator.randomBytes(1_000_000);
      const inputStream = DataStream.fromBytes(inputBytes);

      const cipherStream = await Encryption.aes256CtrEncrypt(key, initializationVector, inputStream);

      const plaintextStream = await Encryption.aes256CtrDecrypt(key, initializationVector, cipherStream);
      const plaintextBytes = await DataStream.toBytes(plaintextStream);

      expect(Comparer.byteArraysEqual(inputBytes, plaintextBytes)).to.be.true;
    });

    it('should emit error on encrypt if the plaintext data stream emits an error', async () => {
      const key = TestDataGenerator.randomBytes(32);
      const initializationVector = TestDataGenerator.randomBytes(16);

      let errorOccurred = false;

      // a mock plaintext stream
      const randomByteGenerator = asyncRandomByteGenerator({ totalIterations: 10, bytesPerIteration: 1 });
      const mockPlaintextStream = new Readable({
        async read(): Promise<void> {
          if (errorOccurred) {
            return;
          }

          // MUST use async generator/iterator, else caller will repeatedly call `read()` in a blocking manner until `null` is returned
          const { value } = await randomByteGenerator.next();
          this.push(value);
        }
      });

      const cipherStream = await Encryption.aes256CtrEncrypt(key, initializationVector, mockPlaintextStream);

      const simulatedErrorMessage = 'Simulated error';

      // test that the `error` event from plaintext stream will propagate to the cipher stream
      const eventPromise = new Promise<void>((resolve, _reject) => {
        cipherStream.on('error', (error) => {
          expect(error).to.equal(simulatedErrorMessage);
          errorOccurred = true;
          resolve();
        });
      });

      // trigger the `error` in the plaintext stream
      mockPlaintextStream.emit('error', simulatedErrorMessage);

      await eventPromise;

      expect(errorOccurred).to.be.true;
    });

    it('should emit error on decrypt if the plaintext data stream emits an error', async () => {
      const key = TestDataGenerator.randomBytes(32);
      const initializationVector = TestDataGenerator.randomBytes(16);

      let errorOccurred = false;

      // a mock cipher stream
      const randomByteGenerator = asyncRandomByteGenerator({ totalIterations: 10, bytesPerIteration: 1 });
      const mockCipherStream = new Readable({
        async read(): Promise<void> {
          if (errorOccurred) {
            return;
          }

          // MUST use async generator/iterator, else caller will repeatedly call `read()` in a blocking manner until `null` is returned
          const { value } = await randomByteGenerator.next();
          this.push(value);
        }
      });

      const plaintextStream = await Encryption.aes256CtrDecrypt(key, initializationVector, mockCipherStream);

      const simulatedErrorMessage = 'Simulated error';

      // test that the `error` event from cipher stream will propagate to the plaintext stream
      const eventPromise = new Promise<void>((resolve, _reject) => {
        plaintextStream.on('error', (error) => {
          expect(error).to.equal(simulatedErrorMessage);
          errorOccurred = true;
          resolve();
        });
      });

      // trigger the `error` in the cipher stream
      mockCipherStream.emit('error', simulatedErrorMessage);

      await eventPromise;

      expect(errorOccurred).to.be.true;
    });
  });

  describe('ECIES-SECP256K1', () => {
    it('should be able to encrypt and decrypt given bytes correctly', async () => {
      const { publicKey, privateKey } = await Secp256k1.generateKeyPairRaw();

      const originalPlaintext = TestDataGenerator.randomBytes(32);
      const encryptionOutput = await Encryption.eciesSecp256k1Encrypt(publicKey, originalPlaintext);
      const decryptionInput = { privateKey, ...encryptionOutput };
      const decryptedPlaintext = await Encryption.eciesSecp256k1Decrypt(decryptionInput);

      expect(Comparer.byteArraysEqual(originalPlaintext, decryptedPlaintext)).to.be.true;
    });
  });
});

/**
 * Generates iterations of random bytes
 */
async function* asyncRandomByteGenerator(input: { totalIterations: number, bytesPerIteration: number }): AsyncGenerator<Uint8Array | null> {
  let i = 0;
  while (i < input.totalIterations) {
    yield TestDataGenerator.randomBytes(input.bytesPerIteration);
    i++;
  }

  yield null;
}
