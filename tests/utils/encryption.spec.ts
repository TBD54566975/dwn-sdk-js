import { ArrayUtility } from '../../src/utils/array.js';
import { DataStream } from '../../src/index.js';
import { Encryption } from '../../src/utils/encryption.js';
import { expect } from 'chai';
import { Readable } from 'readable-stream';
import { Secp256k1 } from '../../src/utils/secp256k1.js';
import { etc as Secp256k1Etc } from '@noble/secp256k1';
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

      expect(ArrayUtility.byteArraysEqual(inputBytes, plaintextBytes)).to.be.true;
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

      expect(ArrayUtility.byteArraysEqual(originalPlaintext, decryptedPlaintext)).to.be.true;
    });

    it('should be able to accept both compressed and uncompressed publicKeys', async () => {
      const originalPlaintext = TestDataGenerator.randomBytes(32);
      const h2b = Secp256k1Etc.hexToBytes;
      // Following test vector was taken from @noble/secp256k1 test file.
      // noble-secp256k1/main/test/vectors/secp256k1/privates.json
      const privateKey = h2b('9c7fc36bc106fd7df5e1078d03e34b9a045892abdd053ec69bfeb22327529f6c');
      const compressed = h2b('03936cb2bd56e681d360bbce6a3a7a1ccbf72f3ab8792edbc45fb08f55b929c588');
      const uncompressed = h2b('04936cb2bd56e681d360bbce6a3a7a1ccbf72f3ab8792edbc45fb08f55b929c588529b8cee53f7eff1da5fc0e6050d952b37d4de5c3b85e952dfe9d9e9b2b3b6eb');
      for (const publicKey of [compressed, uncompressed]) {
        const encrypted = await Encryption.eciesSecp256k1Encrypt(publicKey, originalPlaintext);
        const decrypted = await Encryption.eciesSecp256k1Decrypt({ privateKey, ...encrypted });
        expect(ArrayUtility.byteArraysEqual(originalPlaintext, decrypted)).to.be.true;
      }
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
