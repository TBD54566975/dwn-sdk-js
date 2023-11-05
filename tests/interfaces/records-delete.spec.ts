import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { Jws } from '../../src/index.js';
import { RecordsDelete } from '../../src/interfaces/records-delete.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { Time } from '../../src/utils/time.js';

chai.use(chaiAsPromised);

describe('RecordsDelete', () => {
  describe('create()', () => {
    it('should use `messageTimestamp` as is if given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = Time.getCurrentTimestamp();
      const recordsDelete = await RecordsDelete.create({
        recordId         : 'anything',
        signer           : Jws.createSigner(alice),
        messageTimestamp : currentTime
      });

      expect(recordsDelete.message.descriptor.messageTimestamp).to.equal(currentTime);
    });

    it('should auto-fill `messageTimestamp` if not given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const recordsDelete = await RecordsDelete.create({
        recordId : 'anything',
        signer   : Jws.createSigner(alice)
      });

      expect(recordsDelete.message.descriptor.messageTimestamp).to.exist;
    });
  });
});

