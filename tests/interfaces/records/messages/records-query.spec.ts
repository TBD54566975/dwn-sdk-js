import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { getCurrentTimeInHighPrecision } from '../../../../src/utils/time.js';
import { RecordsQuery } from '../../../../src/interfaces/records/messages/records-query.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';

chai.use(chaiAsPromised);

describe('RecordsQuery', () => {
  describe('create()', () => {
    it('should use `dateCreated` as is if given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = getCurrentTimeInHighPrecision();
      const recordsDelete = await RecordsQuery.create({
        filter                      : { schema: 'anything' },
        dateCreated                 : currentTime,
        authorizationSignatureInput : TestDataGenerator.createSignatureInputFromPersona(alice),
      });

      expect(recordsDelete.message.descriptor.dateCreated).to.equal(currentTime);
    });
  });
});

