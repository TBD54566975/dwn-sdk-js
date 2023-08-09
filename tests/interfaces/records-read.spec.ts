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

    it('should require `recordId` when `protocol` and `protocolPath` are not set', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = getCurrentTimeInHighPrecision();
      const readPromise = RecordsRead.create({
        authorizationSignatureInput : Jws.createSignatureInput(alice),
        date                        : currentTime
      });

      await expect(readPromise).to.be.rejectedWith('must have required property \'recordId\'');
    });

    it('should require `recordId` when `protocolPath` is set and `protocol` is not set', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = getCurrentTimeInHighPrecision();
      const readPromise = RecordsRead.create({
        protocolPath                : 'some/path',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
        date                        : currentTime
      });

      await expect(readPromise).to.be.rejectedWith('must have required property \'recordId\'');
    });

    it('should require `recordId` when `protocol` is set and `protocolPath` is not set', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = getCurrentTimeInHighPrecision();
      const readPromise = RecordsRead.create({
        protocol                    : 'example.com/Proto',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
        date                        : currentTime
      });

      await expect(readPromise).to.be.rejectedWith('must have required property \'recordId\'');
    });
  });
});

