import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { getCurrentTimeInHighPrecision } from '../../../../src/utils/time.js';
import { RecordsDelete } from '../../../../src/interfaces/records/messages/records-delete.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';

chai.use(chaiAsPromised);

describe('RecordsDelete', () => {
  describe('create()', () => {
    it('should use `dateModified` as is if given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = getCurrentTimeInHighPrecision();
      const recordsDelete = await RecordsDelete.create({
        recordId                    : 'anything',
        authorizationSignatureInput : TestDataGenerator.createSignatureInputFromPersona(alice),
        dateModified                : currentTime
      });

      expect(recordsDelete.message.descriptor.dateModified).to.equal(currentTime);
    });

    it('should auto-fill `dateModified` if not given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const recordsDelete = await RecordsDelete.create({
        recordId                    : 'anything',
        authorizationSignatureInput : TestDataGenerator.createSignatureInputFromPersona(alice)
      });

      expect(recordsDelete.message.descriptor.dateModified).to.exist;
    });
  });
});

