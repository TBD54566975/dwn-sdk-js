import { expect } from 'chai';
import { Message } from '../../src/core/message.js';
import { RecordsRead } from '../../src/index.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';

describe('Message', () => {
  describe('getAuthor()', () => {
    it('should return `undefined` if message is not signed', async () => {
      const recordsRead = await RecordsRead.create({
        recordId: await TestDataGenerator.randomCborSha256Cid()
      });

      const author = Message.getAuthor(recordsRead.message);
      expect(author).to.be.undefined;
    });
  });

  describe('toJSON()', () => {
    it('should return the message passed in to the constructor', async () => {
      // create a message without `authorization`
      const { message } = await RecordsRead.create({
        recordId: await TestDataGenerator.randomCborSha256Cid()
      });

      // NOTE: parse() calls constructor internally
      const recordsRead = await RecordsRead.parse(message);
      expect(recordsRead.toJSON()).to.equal(message);
    });
  });
});