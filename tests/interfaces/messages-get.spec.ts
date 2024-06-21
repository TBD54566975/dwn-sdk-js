import type { MessagesGetMessage } from '../../src/index.js';

import { expect } from 'chai';
import { Message } from '../../src/core/message.js';
import { MessagesGet } from '../../src/index.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { DwnErrorCode, Jws } from '../../src/index.js';

describe('MessagesGet Message', () => {
  describe('create', () => {
    it('creates a MessagesGet message', async () => {
      const { author, message } = await TestDataGenerator.generateRecordsWrite();
      const messageCid = await Message.getCid(message);
      const messageTimestamp = TestDataGenerator.randomTimestamp();

      const messagesGet = await MessagesGet.create({
        signer     : await Jws.createSigner(author),
        messageCid : messageCid,
        messageTimestamp,
      });

      expect(messagesGet.message.authorization).to.exist;
      expect(messagesGet.message.descriptor).to.exist;
      expect(messagesGet.message.descriptor.messageCid).to.equal(messageCid);
      expect(messagesGet.message.descriptor.messageTimestamp).to.equal(messageTimestamp);
    });

    it('throws an error if an invalid CID is provided', async () => {
      const alice = await TestDataGenerator.generatePersona();

      try {
        await MessagesGet.create({
          signer     : await Jws.createSigner(alice),
          messageCid : 'abcd'
        });

        expect.fail();
      } catch (e: any) {
        expect(e.message).to.include(DwnErrorCode.MessagesGetInvalidCid);
      }
    });
  });

  describe('parse', () => {
    it('parses a message into a MessagesGet instance', async () => {
      const { author, message } = await TestDataGenerator.generateRecordsWrite();
      let messageCid = await Message.getCid(message);

      const messagesGet = await MessagesGet.create({
        signer     : await Jws.createSigner(author),
        messageCid : messageCid
      });

      const parsed = await MessagesGet.parse(messagesGet.message);
      expect(parsed).to.be.instanceof(MessagesGet);

      const expectedMessageCid = await Message.getCid(messagesGet.message);
      messageCid = await Message.getCid(parsed.message);

      expect(messageCid).to.equal(expectedMessageCid);
    });

    it('throws an exception if messageCids contains an invalid cid', async () => {
      const { author, message: recordsWriteMessage } = await TestDataGenerator.generateRecordsWrite();
      const messageCid = await Message.getCid(recordsWriteMessage);

      const messagesGet = await MessagesGet.create({
        signer     : await Jws.createSigner(author),
        messageCid : messageCid
      });

      const message = messagesGet.toJSON() as MessagesGetMessage;
      message.descriptor.messageCid = 'abcd';

      try {
        await MessagesGet.parse(message);

        expect.fail();
      } catch (e: any) {
        expect(e.message).to.include('is not a valid CID');
      }
    });
  });
});