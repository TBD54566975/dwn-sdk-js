import type { MessagesReadMessage } from '../../src/index.js';

import { expect } from 'chai';
import { Message } from '../../src/core/message.js';
import { MessagesRead } from '../../src/index.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { DwnErrorCode, Jws } from '../../src/index.js';

describe('MessagesRead Message', () => {
  describe('create', () => {
    it('creates a MessagesRead message', async () => {
      const { author, message } = await TestDataGenerator.generateRecordsWrite();
      const messageCid = await Message.getCid(message);
      const messageTimestamp = TestDataGenerator.randomTimestamp();

      const messagesRead = await MessagesRead.create({
        signer     : await Jws.createSigner(author),
        messageCid : messageCid,
        messageTimestamp,
      });

      expect(messagesRead.message.authorization).to.exist;
      expect(messagesRead.message.descriptor).to.exist;
      expect(messagesRead.message.descriptor.messageCid).to.equal(messageCid);
      expect(messagesRead.message.descriptor.messageTimestamp).to.equal(messageTimestamp);
    });

    it('throws an error if an invalid CID is provided', async () => {
      const alice = await TestDataGenerator.generatePersona();

      try {
        await MessagesRead.create({
          signer     : await Jws.createSigner(alice),
          messageCid : 'abcd'
        });

        expect.fail();
      } catch (e: any) {
        expect(e.message).to.include(DwnErrorCode.MessagesReadInvalidCid);
      }
    });
  });

  describe('parse', () => {
    it('parses a message into a MessagesRead instance', async () => {
      const { author, message } = await TestDataGenerator.generateRecordsWrite();
      let messageCid = await Message.getCid(message);

      const messagesRead = await MessagesRead.create({
        signer     : await Jws.createSigner(author),
        messageCid : messageCid
      });

      const parsed = await MessagesRead.parse(messagesRead.message);
      expect(parsed).to.be.instanceof(MessagesRead);

      const expectedMessageCid = await Message.getCid(messagesRead.message);
      messageCid = await Message.getCid(parsed.message);

      expect(messageCid).to.equal(expectedMessageCid);
    });

    it('throws an exception if messageCids contains an invalid cid', async () => {
      const { author, message: recordsWriteMessage } = await TestDataGenerator.generateRecordsWrite();
      const messageCid = await Message.getCid(recordsWriteMessage);

      const messagesRead = await MessagesRead.create({
        signer     : await Jws.createSigner(author),
        messageCid : messageCid
      });

      const message = messagesRead.toJSON() as MessagesReadMessage;
      message.descriptor.messageCid = 'abcd';

      try {
        await MessagesRead.parse(message);

        expect.fail();
      } catch (e: any) {
        expect(e.message).to.include('is not a valid CID');
      }
    });
  });
});