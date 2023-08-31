import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { getCurrentTimeInHighPrecision } from '../../src/utils/time.js';
import { Jws } from '../../src/index.js';
import { RecordsRead } from '../../src/interfaces/records-read.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';

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

    it('should reject if both `recordId` and `filter` are passed', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const readPromise = RecordsRead.create({
        filter: {
          protocol     : 'protocol',
          protocolPath : 'some/path',
        },
        recordId                    : 'some-id',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
      });

      await expect(readPromise).to.be.rejectedWith('/descriptor: must match exactly one schema in oneOf');
    });

    it('should not reject if only `recordId` is passed', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const readSuccess = await RecordsRead.create({
        recordId                    : 'some-id',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
      });

      expect(readSuccess.message.descriptor.recordId).to.equal('some-id');
    });
  });
});

