import type { DidResolver } from '@web5/dids';
import type { EventStream } from '../../src/types/subscriptions.js';
import type {
  DataStore,
  EventLog,
  MessagesGetReply,
  MessageStore,
  ResumableTaskStore,
} from '../../src/index.js';

import { expect } from 'chai';
import { Message } from '../../src/core/message.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { DataStream, Dwn, DwnConstant } from '../../src/index.js';
import { DidKey, UniversalResolver } from '@web5/dids';

import sinon from 'sinon';

export function testMessagesGetHandler(): void {
  describe('MessagesGetHandler.handle()', () => {
    let dwn: Dwn;
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let resumableTaskStore: ResumableTaskStore;
    let eventLog: EventLog;
    let eventStream: EventStream;

    // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
    // so that different test suites can reuse the same backend store for testing
    before(async () => {
      didResolver = new UniversalResolver({ didResolvers: [DidKey] });

      const stores = TestStores.get();
      messageStore = stores.messageStore;
      dataStore = stores.dataStore;
      resumableTaskStore = stores.resumableTaskStore;
      eventLog = stores.eventLog;
      eventStream = TestEventStream.get();

      dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog, eventStream, resumableTaskStore });
    });

    beforeEach(async () => {
    // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
      await messageStore.clear();
      await dataStore.clear();
      await resumableTaskStore.clear();
      await eventLog.clear();

      sinon.restore(); // wipe all previous stubs/spies/mocks/fakes
    });

    after(async () => {
      await dwn.close();
    });

    it('returns a 401 if tenant is not author', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();
      const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author: alice });

      const { message } = await TestDataGenerator.generateMessagesGet({
        author     : alice,
        messageCid : await Message.getCid(recordsWrite.message)
      });

      const reply = await dwn.processMessage(bob.did, message);

      expect(reply.status.code).to.equal(401);
    });

    it('returns a 400 if message is invalid', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author: alice });

      const { message } = await TestDataGenerator.generateMessagesGet({
        author     : alice,
        messageCid : await Message.getCid(recordsWrite.message)
      });

      (message['descriptor'] as any)['troll'] = 'hehe';

      const reply = await dwn.processMessage(alice.did, message);

      expect(reply.status.code).to.equal(400);
    });

    it('returns a 400 if message contains an invalid message cid', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author: alice });

      const { message } = await TestDataGenerator.generateMessagesGet({
        author     : alice,
        messageCid : await Message.getCid(recordsWrite.message)
      });

      message.descriptor.messageCid = 'hehetroll';

      const reply: MessagesGetReply = await dwn.processMessage(alice.did, message);

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.include('is not a valid CID');
      expect(reply.entry).to.be.undefined;
    });

    it('returns message as undefined in reply entry when a messageCid is not found', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author: alice });
      const recordsWriteMessageCid = await Message.getCid(recordsWrite.message);

      const { message } = await TestDataGenerator.generateMessagesGet({
        author     : alice,
        messageCid : recordsWriteMessageCid
      });

      // returns a 404 because the RecordsWrite created above was never stored
      const reply: MessagesGetReply = await dwn.processMessage(alice.did, message);
      expect(reply.status.code).to.equal(404);
    });

    describe('gets data in the reply entry', () => {
      it('data is less than threshold', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        const { recordsWrite, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({
          author : alice,
          data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded),
        });

        const reply = await dwn.processMessage(alice.did, recordsWrite.toJSON(), { dataStream });
        expect(reply.status.code).to.equal(202);

        const recordsWriteMessageCid = await Message.getCid(recordsWrite.message);
        const { message } = await TestDataGenerator.generateMessagesGet({
          author     : alice,
          messageCid : recordsWriteMessageCid
        });

        const messagesGetReply: MessagesGetReply = await dwn.processMessage(alice.did, message);
        expect(messagesGetReply.status.code).to.equal(200);
        expect(messagesGetReply.entry).to.exist;

        const messageReply = messagesGetReply.entry!;
        expect(messageReply.messageCid).to.exist;
        expect(messageReply.messageCid).to.equal(recordsWriteMessageCid);

        expect(messageReply.message).to.exist.and.not.be.undefined;
        expect(messageReply.message?.data).to.exist.and.not.be.undefined;
        const messageData = await DataStream.toBytes(messageReply.message!.data!);
        expect(messageData).to.eql(dataBytes);
      });

      it('data is greater than threshold', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        const { recordsWrite, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({
          author : alice,
          data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 10),
        });

        const reply = await dwn.processMessage(alice.did, recordsWrite.toJSON(), { dataStream });
        expect(reply.status.code).to.equal(202);

        const recordsWriteMessageCid = await Message.getCid(recordsWrite.message);
        const { message } = await TestDataGenerator.generateMessagesGet({
          author     : alice,
          messageCid : recordsWriteMessageCid
        });

        const messagesGetReply: MessagesGetReply = await dwn.processMessage(alice.did, message);
        expect(messagesGetReply.status.code).to.equal(200);
        expect(messagesGetReply.entry).to.exist;

        const messageReply = messagesGetReply.entry!;
        expect(messageReply.messageCid).to.exist;
        expect(messageReply.messageCid).to.equal(recordsWriteMessageCid);

        expect(messageReply.message).to.exist.and.not.be.undefined;
        expect(messageReply.message?.data).to.exist.and.not.be.undefined;
        const messageData = await DataStream.toBytes(messageReply.message!.data!);
        expect(messageData).to.eql(dataBytes);
      });

      it('data is not available', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // initial write
        const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
          author : alice,
          data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 10),
        });

        const initialMessageCid = await Message.getCid(recordsWrite.message);

        let reply = await dwn.processMessage(alice.did, recordsWrite.toJSON(), { dataStream });
        expect(reply.status.code).to.equal(202);

        const { recordsWrite: updateMessage, dataStream: updateDataStream } = await TestDataGenerator.generateFromRecordsWrite({
          author        : alice,
          existingWrite : recordsWrite,
          data          : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 10),
        });

        reply = await dwn.processMessage(alice.did, updateMessage.toJSON(), { dataStream: updateDataStream });
        expect(reply.status.code).to.equal(202);

        const { message } = await TestDataGenerator.generateMessagesGet({
          author     : alice,
          messageCid : initialMessageCid
        });

        const messagesGetReply: MessagesGetReply = await dwn.processMessage(alice.did, message);
        expect(messagesGetReply.status.code).to.equal(200);
        expect(messagesGetReply.entry).to.exist;

        const messageReply = messagesGetReply.entry!;
        expect(messageReply.messageCid).to.exist;
        expect(messageReply.messageCid).to.equal(initialMessageCid);

        expect(messageReply.message).to.exist.and.not.be.undefined;
        expect(messageReply.message?.data).to.be.undefined;
      });
    });

    it('returns a data stream if the data is larger than the encodedData threshold', async () => {
    });

    it('does not return messages that belong to other tenants', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();

      const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
        author: alice
      });

      const reply = await dwn.processMessage(alice.did, recordsWrite.toJSON(), { dataStream });
      expect(reply.status.code).to.equal(202);

      const { message } = await TestDataGenerator.generateMessagesGet({
        author     : bob,
        messageCid : await Message.getCid(recordsWrite.message)
      });

      // returns a 404 because the RecordsWrite created above is not bob's
      const messagesGetReply: MessagesGetReply = await dwn.processMessage(bob.did, message);
      expect(messagesGetReply.status.code).to.equal(404);
    });
  });
}