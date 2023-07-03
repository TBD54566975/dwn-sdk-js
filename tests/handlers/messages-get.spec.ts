import type {
  DataStore,
  EventLog,
  MessagesGetReply,
  MessageStore
} from '../../src/index.js';

import { expect } from 'chai';
import { Message } from '../../src/core/message.js';
import { MessagesGetHandler } from '../../src/handlers/messages-get.js';
import { stubInterface } from 'ts-sinon';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStoreInitializer } from '../test-store-initializer.js';

import { DidKeyResolver, DidResolver, Dwn } from '../../src/index.js';

import sinon from 'sinon';

describe('MessagesGetHandler.handle()', () => {
  let dwn: Dwn;
  let didResolver: DidResolver;
  let messageStore: MessageStore;
  let dataStore: DataStore;
  let eventLog: EventLog;

  // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
  // so that different test suites can reuse the same backend store for testing
  before(async () => {
    didResolver = new DidResolver([new DidKeyResolver()]);

    const stores = TestStoreInitializer.initializeStores();
    messageStore = stores.messageStore;
    dataStore = stores.dataStore;
    eventLog = stores.eventLog;

    dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog });
  });

  beforeEach(async () => {
    // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
    await messageStore.clear();
    await dataStore.clear();
    await eventLog.clear();

    sinon.restore(); // wipe all previous stubs/spies/mocks/fakes
  });

  after(async () => {
    await dwn.close();
  });

  it('returns a 401 if tenant is not author', async () => {
    const alice = await DidKeyResolver.generate();
    const bob = await DidKeyResolver.generate();
    const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author: alice });

    const { message } = await TestDataGenerator.generateMessagesGet({
      author      : alice,
      messageCids : [await Message.getCid(recordsWrite.message)]
    });

    const reply = await dwn.processMessage(bob.did, message);

    expect(reply.status.code).to.equal(401);
    expect(reply.entries).to.not.exist;
    expect(reply.data).to.not.exist;
  });

  it('returns a 400 if message is invalid', async () => {
    const alice = await DidKeyResolver.generate();
    const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author: alice });

    const { message } = await TestDataGenerator.generateMessagesGet({
      author      : alice,
      messageCids : [await Message.getCid(recordsWrite.message)]
    });

    (message['descriptor'] as any)['troll'] = 'hehe';

    const reply = await dwn.processMessage(alice.did, message);

    expect(reply.status.code).to.equal(400);
    expect(reply.entries).to.not.exist;
    expect(reply.data).to.not.exist;
  });

  it('returns a 400 if message contains an invalid message cid', async () => {
    const alice = await DidKeyResolver.generate();
    const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author: alice });

    const { message } = await TestDataGenerator.generateMessagesGet({
      author      : alice,
      messageCids : [await Message.getCid(recordsWrite.message)]
    });

    message.descriptor.messageCids = ['hehetroll'];

    const reply: MessagesGetReply = await dwn.processMessage(alice.did, message);

    expect(reply.status.code).to.equal(400);
    expect(reply.status.detail).to.include('is not a valid CID');
    expect(reply.messages).to.be.undefined;
  });

  it('returns all requested messages', async () => {
    const did = await DidKeyResolver.generate();
    const alice = await TestDataGenerator.generatePersona(did);
    const messageCids: string[] = [];

    const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
      author: alice
    });

    let messageCid = await Message.getCid(recordsWrite.message);
    messageCids.push(messageCid);

    let reply = await dwn.processMessage(alice.did, recordsWrite.toJSON(), dataStream);
    expect(reply.status.code).to.equal(202);

    const { recordsDelete } = await TestDataGenerator.generateRecordsDelete({
      author   : alice,
      recordId : recordsWrite.message.recordId
    });

    messageCid = await Message.getCid(recordsDelete.message);
    messageCids.push(messageCid);

    reply = await dwn.processMessage(alice.did, recordsDelete.toJSON());
    expect(reply.status.code).to.equal(202);

    const { protocolsConfigure } = await TestDataGenerator.generateProtocolsConfigure({
      author: alice
    });

    messageCid = await Message.getCid(protocolsConfigure.message);
    messageCids.push(messageCid);

    reply = await dwn.processMessage(alice.did, protocolsConfigure.toJSON());
    expect(reply.status.code).to.equal(202);

    const { messagesGet } = await TestDataGenerator.generateMessagesGet({
      author: alice,
      messageCids
    });

    const messagesGetReply: MessagesGetReply = await dwn.processMessage(alice.did, messagesGet.toJSON());
    expect(messagesGetReply.status.code).to.equal(200);
    expect(messagesGetReply.messages!.length).to.equal(messageCids.length);

    for (const messageReply of messagesGetReply.messages!) {
      expect(messageReply.messageCid).to.not.be.undefined;
      expect(messageReply.message).to.not.be.undefined;
      expect(messageCids).to.include(messageReply.messageCid);

      const cid = await Message.getCid(messageReply.message!);
      expect(messageReply.messageCid).to.equal(cid);
    }
  });

  it('returns message as undefined in reply entry when a messageCid is not found', async () => {
    const alice = await DidKeyResolver.generate();
    const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author: alice });
    const recordsWriteMessageCid = await Message.getCid(recordsWrite.message);

    const { message } = await TestDataGenerator.generateMessagesGet({
      author      : alice,
      messageCids : [recordsWriteMessageCid]
    });

    // 0 messages expected because the RecordsWrite created above was never stored
    const reply: MessagesGetReply = await dwn.processMessage(alice.did, message);
    expect(reply.status.code).to.equal(200);
    expect(reply.messages!.length).to.equal(1);

    for (const messageReply of reply.messages!) {
      expect(messageReply.messageCid).to.equal(recordsWriteMessageCid);
      expect(messageReply.message).to.be.undefined;
    }
  });

  it('returns an error message for a specific cid if getting that message from the MessageStore fails', async () => {
    // stub the messageStore.get call to throw an error
    const messageStore = stubInterface<MessageStore>();
    messageStore.get.rejects('internal db error');

    const dataStore = stubInterface<DataStore>();

    const messagesGetHandler = new MessagesGetHandler(didResolver, messageStore, dataStore);

    const alice = await DidKeyResolver.generate();
    const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author: alice });
    const recordsWriteMessageCid = await Message.getCid(recordsWrite.message);

    const { message } = await TestDataGenerator.generateMessagesGet({
      author      : alice,
      messageCids : [recordsWriteMessageCid]
    });

    const reply = await messagesGetHandler.handle({ tenant: alice.did, message });

    expect(messageStore.get.called).to.be.true;

    expect(reply.status.code).to.equal(200);
    expect(reply.messages!.length).to.equal(1);
    expect(reply.messages![0].error).to.exist;
    expect(reply.messages![0].error).to.include(`Failed to get message ${recordsWriteMessageCid}`);
    expect(reply.messages![0].message).to.be.undefined;
  });

  it('includes encodedData in reply entry if the data is available and dataSize < threshold', async () => {
    const alice = await DidKeyResolver.generate();

    const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
      author: alice
    });

    const reply = await dwn.processMessage(alice.did, recordsWrite.toJSON(), dataStream);
    expect(reply.status.code).to.equal(202);

    const recordsWriteMessageCid = await Message.getCid(recordsWrite.message);
    const { message } = await TestDataGenerator.generateMessagesGet({
      author      : alice,
      messageCids : [recordsWriteMessageCid]
    });

    const messagesGetReply: MessagesGetReply = await dwn.processMessage(alice.did, message);
    expect(messagesGetReply.status.code).to.equal(200);
    expect(messagesGetReply.messages!.length).to.equal(1);

    for (const messageReply of messagesGetReply.messages!) {
      expect(messageReply.messageCid).to.exist;
      expect(messageReply.messageCid).to.equal(recordsWriteMessageCid);

      expect(messageReply.message).to.exist.and.not.be.undefined;
      expect(messageReply.encodedData).to.exist.and.not.be.undefined;
    }
  });

  it('does not return messages that belong to other tenants', async () => {
    const alice = await DidKeyResolver.generate();
    const bob = await DidKeyResolver.generate();

    const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
      author: alice
    });

    const reply = await dwn.processMessage(alice.did, recordsWrite.toJSON(), dataStream);
    expect(reply.status.code).to.equal(202);

    const recordsWriteMessageCid = await Message.getCid(recordsWrite.message);
    const { message } = await TestDataGenerator.generateMessagesGet({
      author      : bob,
      messageCids : [await Message.getCid(recordsWrite.message)]
    });

    // 0 messages expected because the RecordsWrite created above is not bob's
    const messagesGetReply: MessagesGetReply = await dwn.processMessage(bob.did, message);
    expect(messagesGetReply.status.code).to.equal(200);
    expect(messagesGetReply.messages!.length).to.equal(1);

    for (const messageReply of messagesGetReply.messages!) {
      expect(messageReply.messageCid).to.equal(recordsWriteMessageCid);
      expect(messageReply.message).to.be.undefined;
    }
  });
});