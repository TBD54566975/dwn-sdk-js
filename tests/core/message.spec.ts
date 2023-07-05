import { expect } from 'chai';
import { Message } from '../../src/core/message.js';
import { RecordsRead } from '../../src/index.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { getCurrentTimeInHighPrecision, sleep } from '../../src/utils/time.js';

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

  describe('compareMessageTimestamp', () => {
    it('should return 0 if age is same', async () => {
      const dateModified = getCurrentTimeInHighPrecision();
      const a = (await TestDataGenerator.generateRecordsWrite({ messageTimestamp: dateModified })).message;
      const b = JSON.parse(JSON.stringify(a)); // create a deep copy of `a`

      const compareResult = await Message.compareMessageTimestamp(a, b);
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

      const newestMessage = await Message.getNewestMessage([b, c, a]);
      expect((newestMessage as any).recordId).to.equal(c.recordId);
    });
  });
});