import type { MessagesGetReply } from '../../../../src/index.js';

import { expect } from 'chai';
import { Message } from '../../../../src/core/message.js';
import { MessagesGetHandler } from '../../../../src/interfaces/messages/handlers/messages-get.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import {
  DataStoreLevel,
  DidKeyResolver,
  DidResolver,
  Dwn,
  EventLogLevel,
  MessageStoreLevel
} from '../../../../src/index.js';

import sinon from 'sinon';

describe('MessagesGetHandler.handle()', () => {
  let dwn: Dwn;
  let didResolver: DidResolver;
  let messageStore: MessageStoreLevel;
  let dataStore: DataStoreLevel;
  let eventLog: EventLogLevel;

  before(async () => {
    didResolver = new DidResolver([new DidKeyResolver()]);

    // important to follow this pattern to initialize and clean the message and data store in tests
    // so that different suites can reuse the same block store and index location for testing
    messageStore = new MessageStoreLevel({
      blockstoreLocation : 'TEST-MESSAGESTORE',
      indexLocation      : 'TEST-INDEX'
    });

    dataStore = new DataStoreLevel({
      blockstoreLocation: 'TEST-DATASTORE'
    });

    eventLog = new EventLogLevel({
      location: 'TEST-EVENTLOG'
    });

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
    const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({ requester: alice });

    const { message } = await TestDataGenerator.generateMessagesGet({
      requester   : alice,
      messageCids : [await Message.getCid(recordsWrite.message)]
    });

    const reply = await dwn.processMessage(bob.did, message);

    expect(reply.status.code).to.equal(401);
    expect(reply.entries).to.not.exist;
    expect(reply.data).to.not.exist;
  });

  it('returns a 400 if message is invalid', async () => {
    const alice = await DidKeyResolver.generate();
    const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({ requester: alice });

    const { message } = await TestDataGenerator.generateMessagesGet({
      requester   : alice,
      messageCids : [await Message.getCid(recordsWrite.message)]
    });

    message['descriptor']['troll'] = 'hehe';

    const reply = await dwn.processMessage(alice.did, message);

    expect(reply.status.code).to.equal(400);
    expect(reply.entries).to.not.exist;
    expect(reply.data).to.not.exist;
  });

  it('returns a 400 if message contains an invalid message cid', async () => {
    const alice = await DidKeyResolver.generate();
    const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({ requester: alice });

    const { message } = await TestDataGenerator.generateMessagesGet({
      requester   : alice,
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
      requester: alice
    });

    let messageCid = await Message.getCid(recordsWrite.message);
    messageCids.push(messageCid);

    let reply = await dwn.processMessage(alice.did, recordsWrite.toJSON(), dataStream);
    expect(reply.status.code).to.equal(202);

    const { recordsDelete } = await TestDataGenerator.generateRecordsDelete({
      requester : alice,
      recordId  : recordsWrite.message.recordId
    });

    messageCid = await Message.getCid(recordsDelete.message);
    messageCids.push(messageCid);

    reply = await dwn.processMessage(alice.did, recordsDelete.toJSON());
    expect(reply.status.code).to.equal(202);

    const { protocolsConfigure } = await TestDataGenerator.generateProtocolsConfigure({
      requester: alice
    });

    messageCid = await Message.getCid(protocolsConfigure.message);
    messageCids.push(messageCid);

    reply = await dwn.processMessage(alice.did, protocolsConfigure.toJSON());
    expect(reply.status.code).to.equal(202);

    const { messagesGet } = await TestDataGenerator.generateMessagesGet({
      requester: alice,
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
    const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({ requester: alice });
    const recordsWriteMessageCid = await Message.getCid(recordsWrite.message);

    const { message } = await TestDataGenerator.generateMessagesGet({
      requester   : alice,
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
    const messageStore = sinon.createStubInstance(MessageStoreLevel);
    messageStore.get.rejects('internal db error');

    const dataStore = sinon.createStubInstance(DataStoreLevel);

    const messagesGetHandler = new MessagesGetHandler(didResolver, messageStore, dataStore);

    const alice = await DidKeyResolver.generate();
    const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({ requester: alice });
    const recordsWriteMessageCid = await Message.getCid(recordsWrite.message);

    const { message } = await TestDataGenerator.generateMessagesGet({
      requester   : alice,
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
      requester: alice
    });

    const reply = await dwn.processMessage(alice.did, recordsWrite.toJSON(), dataStream);
    expect(reply.status.code).to.equal(202);

    const recordsWriteMessageCid = await Message.getCid(recordsWrite.message);
    const { message } = await TestDataGenerator.generateMessagesGet({
      requester   : alice,
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
      requester: alice
    });

    const reply = await dwn.processMessage(alice.did, recordsWrite.toJSON(), dataStream);
    expect(reply.status.code).to.equal(202);

    const recordsWriteMessageCid = await Message.getCid(recordsWrite.message);
    const { message } = await TestDataGenerator.generateMessagesGet({
      requester   : bob,
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