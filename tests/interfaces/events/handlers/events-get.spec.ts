import type { Event, MessageReply } from '../../../../src/index.js';

import { expect } from 'chai';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import {
  DataStoreLevel,
  DidKeyResolver,
  DidResolver,
  Dwn,
  EventLogLevel,
  MessageStoreLevel,
} from '../../../../src/index.js';

import { Message } from '../../../../src/core/message.js';

describe('EventsGetHandler.handle()', () => {
  let didResolver: DidResolver;
  let messageStore: MessageStoreLevel;
  let dataStore: DataStoreLevel;
  let eventLog: EventLogLevel;
  let dwn: Dwn;

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
  });

  after(async () => {
    await dwn.close();
  });

  it('returns a 401 if tenant is not author', async () => {
    const alice = await DidKeyResolver.generate();
    const bob = await DidKeyResolver.generate();

    const { message } = await TestDataGenerator.generateEventsGet({ requester: alice });
    const reply = await dwn.processMessage(bob.did, message);

    expect(reply.status.code).to.equal(401);
    expect(reply.entries).to.not.exist;
    expect(reply.data).to.not.exist;
  });

  it('returns a 400 if message is invalid', async () => {
    const alice = await DidKeyResolver.generate();

    const { message } = await TestDataGenerator.generateEventsGet({ requester: alice });
    message['descriptor']['troll'] = 'hehe';

    const reply = await dwn.processMessage(alice.did, message);

    expect(reply.status.code).to.equal(400);
    expect(reply.entries).to.not.exist;
    expect(reply.data).to.not.exist;
  });

  it('returns all events for a tenant if watermark is not provided', async () => {
    const alice = await DidKeyResolver.generate();
    const expectedCids: string[] = [];

    for (let i = 0; i < 5; i += 1) {
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice });
      const reply = await dwn.processMessage(alice.did, message, dataStream);

      expect(reply.status.code).to.equal(202);
      const messageCid = await Message.getCid(message);
      expectedCids.push(messageCid);

    }

    const { message } = await TestDataGenerator.generateEventsGet({ requester: alice });
    const reply: MessageReply<Event> = await dwn.processMessage(alice.did, message);

    expect(reply.status.code).to.equal(200);
    expect(reply.data).to.not.exist;
    expect(reply.entries?.length).to.equal(expectedCids.length);

    for (let i = 0; i < reply.entries!.length; i += 1) {
      expect(reply.entries![i].messageCid).to.equal(expectedCids[i]);
    }
  });

  it('returns all events after watermark if watermark is provided', async () => {
    const alice = await DidKeyResolver.generate();

    for (let i = 0; i < 5; i += 1) {
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice });
      const reply = await dwn.processMessage(alice.did, message, dataStream);

      expect(reply.status.code).to.equal(202);
    }

    const { message } = await TestDataGenerator.generateEventsGet({ requester: alice });
    let reply: MessageReply<Event> = await dwn.processMessage(alice.did, message);

    expect(reply.status.code).to.equal(200);

    const watermark = reply.entries![reply.entries!.length - 1].watermark;
    const expectedCids: string[] = [];

    for (let i = 0; i < 3; i += 1) {
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice });
      const reply = await dwn.processMessage(alice.did, message, dataStream);

      expect(reply.status.code).to.equal(202);
      const messageCid = await Message.getCid(message);
      expectedCids.push(messageCid);
    }

    const { message: m } = await TestDataGenerator.generateEventsGet({ requester: alice, watermark });
    reply = await dwn.processMessage(alice.did, m);

    expect(reply.status.code).to.equal(200);
    expect(reply.data).to.not.exist;
    expect(reply.entries!.length).to.equal(expectedCids.length);

    for (let i = 0; i < reply.entries!.length; i += 1) {
      expect(reply.entries![i].messageCid).to.equal(expectedCids[i]);
    }
  });
});