import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { getCurrentTimeInHighPrecision } from '../../src/utils/time.js';
import { RecordsRead } from '../../src/interfaces/records-read.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { DwnErrorCode, Jws } from '../../src/index.js';

chai.use(chaiAsPromised);

describe('RecordsRead', () => {
  describe('create()', () => {
    it('should use `messageTimestamp` as is if given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = getCurrentTimeInHighPrecision();
      const recordsRead = await RecordsRead.create({
        recordId                    : 'anything',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
        date                        : currentTime
      });

      expect(recordsRead.message.descriptor.messageTimestamp).to.equal(currentTime);
    });

    it('should reject if `recordId`, `protocol` and `protocolPath` are all missing', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const readPromise = RecordsRead.create({
        authorizationSignatureInput: Jws.createSignatureInput(alice),
      });

      await expect(readPromise).to.be.rejectedWith(DwnErrorCode.RecordsReadMissingCreateProperties);
    });

    it('should not reject if only `recordId` is passed', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const readPromiseSuccess = RecordsRead.create({
        recordId                    : 'some-id',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
      });

      await expect(readPromiseSuccess).to.not.be.rejected;
    });

    it('should reject if only one of `protocol` or `protocolPath` are set', async () => {
      const alice = await TestDataGenerator.generatePersona();
      // with only protocolPath
      const protocolPathOnlyP = RecordsRead.create({
        protocolPath                : 'some/path',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
      });

      await expect(protocolPathOnlyP).to.be.rejectedWith(DwnErrorCode.RecordsReadMissingCreateProperties);
      // with only protocolPath
      const protocolOnlyP = RecordsRead.create({
        protocol                    : 'protocol',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
      });

      await expect(protocolOnlyP).to.be.rejectedWith(DwnErrorCode.RecordsReadMissingCreateProperties);

      const readPromiseSuccess = RecordsRead.create({
        protocol                    : 'protocol',
        protocolPath                : 'some/path',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
      });

      await expect(readPromiseSuccess).to.not.be.rejected;
    });
  });
});

