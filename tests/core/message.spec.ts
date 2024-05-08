import type { RecordsQueryReplyEntry } from '../../src/types/records-types.js';

import { expect } from 'chai';
import { Message } from '../../src/core/message.js';
import { RecordsRead } from '../../src/index.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { Time } from '../../src/utils/time.js';

describe('Message', () => {
  describe('getSigner()', () => {
    it('should return `undefined` if message is not signed', async () => {
      const recordsRead = await RecordsRead.create({
        filter: {
          recordId: await TestDataGenerator.randomCborSha256Cid()
        }
      });

      const author = Message.getSigner(recordsRead.message);
      expect(author).to.be.undefined;
    });
  });

  describe('getAuthor()', () => {
    it('should return the signer of various message types', async () => {
      const bob = await TestDataGenerator.generatePersona();

      // create a protocol message without `authorization`
      const { message: protocolsQueryMessage } = await TestDataGenerator.generateProtocolsQuery({ author: bob });
      const author = Message.getAuthor(protocolsQueryMessage);
      expect(author).to.equal(bob.did);

      // create a record message
      const { message: recordsWriteMessage } = await TestDataGenerator.generateRecordsWrite({ author: bob });
      const author2 = Message.getAuthor(recordsWriteMessage);
      expect(author2).to.equal(bob.did);

      // create a delete message
      const { message: recordsDeleteMessage } = await TestDataGenerator.generateRecordsDelete({ author: bob });
      const author3 = Message.getAuthor(recordsDeleteMessage);
      expect(author3).to.equal(bob.did);
    });
  });

  describe('toJSON()', () => {
    it('should return the message passed in to the constructor', async () => {
      // create a message without `authorization`
      const { message } = await RecordsRead.create({
        filter: {
          recordId: await TestDataGenerator.randomCborSha256Cid()
        }
      });

      // NOTE: parse() calls constructor internally
      const recordsRead = await RecordsRead.parse(message);
      expect(recordsRead.toJSON()).to.equal(message);
    });
  });

  describe('compareMessageTimestamp', () => {
    it('should return 0 if age is same', async () => {
      const dateModified = Time.getCurrentTimestamp();
      const a = (await TestDataGenerator.generateRecordsWrite({ messageTimestamp: dateModified })).message;
      const b = JSON.parse(JSON.stringify(a)); // create a deep copy of `a`

      const compareResult = await Message.compareMessageTimestamp(a, b);
      expect(compareResult).to.equal(0);
    });
  });

  describe('getNewestMessage', () => {
    it('should return the newest message', async () => {
      const a = (await TestDataGenerator.generateRecordsWrite()).message;
      await Time.minimalSleep();
      const b = (await TestDataGenerator.generateRecordsWrite()).message;
      await Time.minimalSleep();
      const c = (await TestDataGenerator.generateRecordsWrite()).message; // c is the newest since its created last

      const newestMessage = await Message.getNewestMessage([b, c, a]);
      expect((newestMessage as any).recordId).to.equal(c.recordId);
    });
  });

  describe('getOldestMessage', () => {
    it('should return the newest message', async () => {
      const a = (await TestDataGenerator.generateRecordsWrite()).message;
      await Time.minimalSleep();
      const b = (await TestDataGenerator.generateRecordsWrite()).message;
      await Time.minimalSleep();
      const c = (await TestDataGenerator.generateRecordsWrite()).message; // c is the newest since its created last

      const newestMessage = await Message.getOldestMessage([b, c, a]);
      expect((newestMessage as any).recordId).to.equal(a.recordId);
    });
  });

  describe('getCid()', () => {
    it('encodedData does not have an effect on getCid()', async () => {
      const { message } = await TestDataGenerator.generateRecordsWrite();
      const cid1 = await Message.getCid(message);

      const messageWithData: RecordsQueryReplyEntry = message;
      messageWithData.encodedData = TestDataGenerator.randomString(25);

      const cid2 = await Message.getCid(messageWithData);

      expect(cid1).to.equal(cid2);
    });
  });
});