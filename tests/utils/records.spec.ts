import type { DerivedPrivateJwk } from '../../src/index.js';

import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { ed25519 } from '../../src/jose/algorithms/signing/ed25519.js';
import { expect } from 'chai';
import { TestDataGenerator } from './test-data-generator.js';
import { getCurrentTimeInHighPrecision, sleep } from '../../src/utils/time.js';
import { KeyDerivationScheme, Records } from '../../src/index.js';

describe('Records', () => {
  describe('deriveLeafPublicKey()', () => {
    it('should throw if given public key is not supported', async () => {
      const rootPublicKey = (await ed25519.generateKeyPair()).publicJwk;
      await expect(Records.deriveLeafPublicKey(rootPublicKey, ['a'])).to.be.rejectedWith(DwnErrorCode.RecordsDeriveLeafPublicKeyUnSupportedCurve);
    });
  });

  describe('deriveLeafPrivateKey()', () => {
    it('should throw if given private key is not supported', async () => {
      const derivedKey: DerivedPrivateJwk = {
        rootKeyId         : 'unused',
        derivationScheme  : KeyDerivationScheme.Protocols,
        derivedPrivateKey : (await ed25519.generateKeyPair()).privateJwk
      };
      await expect(Records.deriveLeafPrivateKey(derivedKey, ['a'])).to.be.rejectedWith(DwnErrorCode.RecordsDeriveLeafPrivateKeyUnSupportedCurve);
    });
  });

  describe('compareModifiedTime', () => {
    it('should return 0 if age is same', async () => {
      const dateModified = getCurrentTimeInHighPrecision();
      const a = (await TestDataGenerator.generateRecordsWrite({ dateModified })).message;
      const b = JSON.parse(JSON.stringify(a)); // create a deep copy of `a`

      const compareResult = await Records.compareModifiedTime(a, b);
      expect(compareResult).to.equal(0);
    });
  });

  describe('getNewestMessage', () => {
    it('should return the newest message', async () => {
      const a = (await TestDataGenerator.generateRecordsWrite()).message;
      await sleep(1); // need to sleep for at least one millisecond else some messages get generated with the same time
      const b = (await TestDataGenerator.generateRecordsWrite()).message;
      await sleep(1);
      const c = (await TestDataGenerator.generateRecordsWrite()).message; // c is the newest since its created last

      const newestMessage = await Records.getNewestMessage([b, c, a]);
      expect((newestMessage as any).recordId).to.equal(c.recordId);
    });
  });
});
