import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { getCurrentTimeInHighPrecision } from '../../../../src/utils/time.js';
import { Jws } from '../../../../src/index.js';
import { RecordsRead } from '../../../../src/interfaces/records/messages/records-read.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';

chai.use(chaiAsPromised);

describe('RecordsRead', () => {
  describe('create()', () => {
    it('should use `dateModified` as is if given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = getCurrentTimeInHighPrecision();
      const recordsRead = await RecordsRead.create({
        recordId                    : 'anything',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
        date                        : currentTime
      });

      expect(recordsRead.message.descriptor.date).to.equal(currentTime);
    });
  });
});

