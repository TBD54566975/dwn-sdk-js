import type { EventsQueryReply } from '../../src/types/event-types.js';
import type {
  DataStore,
  EventLog,
  MessageStore
} from '../../src/index.js';

import { EventsQueryHandler } from '../../src/handlers/events-query.js';
import { expect } from 'chai';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStores } from '../test-stores.js';
import {
  DidKeyResolver,
  DidResolver,
  Dwn,
  Message,
  Time
} from '../../src/index.js';


export function testEventsQueryHandler(): void {
  describe('EventsQueryHandler.handle()', () => {
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let eventLog: EventLog;
    let dwn: Dwn;

    // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
    // so that different test suites can reuse the same backend store for testing
    before(async () => {
      didResolver = new DidResolver([new DidKeyResolver()]);

      const stores = TestStores.get();
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
    });

    after(async () => {
      await dwn.close();
    });

    it('returns events filtered by a date range', async () => {
      // scenario: 4 records, created on first of 2021, 2022, 2023, 2024 respectively, only the first 2 records
      const firstDayOf2021 = Time.createTimestamp({ year: 2021, month: 1, day: 1 });
      const firstDayOf2022 = Time.createTimestamp({ year: 2022, month: 1, day: 1 });
      const firstDayOf2023 = Time.createTimestamp({ year: 2023, month: 1, day: 1 });
      const firstDayOf2024 = Time.createTimestamp({ year: 2024, month: 1, day: 1 });

      const alice = await DidKeyResolver.generate();
      const write1 = await TestDataGenerator.generateRecordsWrite({ author: alice, dateCreated: firstDayOf2021, messageTimestamp: firstDayOf2021 });
      const write2 = await TestDataGenerator.generateRecordsWrite({ author: alice, dateCreated: firstDayOf2022, messageTimestamp: firstDayOf2022 });
      const write3 = await TestDataGenerator.generateRecordsWrite({ author: alice, dateCreated: firstDayOf2023, messageTimestamp: firstDayOf2023 });
      const write4 = await TestDataGenerator.generateRecordsWrite({ author: alice, dateCreated: firstDayOf2024, messageTimestamp: firstDayOf2024 });

      // insert data
      const writeReply1 = await dwn.processMessage(alice.did, write1.message, write1.dataStream);
      const writeReply2 = await dwn.processMessage(alice.did, write2.message, write2.dataStream);
      const writeReply3 = await dwn.processMessage(alice.did, write3.message, write3.dataStream);
      const writeReply4 = await dwn.processMessage(alice.did, write4.message, write4.dataStream);
      expect(writeReply1.status.code).to.equal(202);
      expect(writeReply2.status.code).to.equal(202);
      expect(writeReply3.status.code).to.equal(202);
      expect(writeReply4.status.code).to.equal(202);

      // testing `from` range
      const lastDayOf2021 = Time.createTimestamp({ year: 2021, month: 12, day: 31 });
      const eventsQuery1 = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ dateCreated: { from: lastDayOf2021 } }],
      });
      const reply1 = await dwn.processMessage(alice.did, eventsQuery1.message) as EventsQueryReply;
      expect(reply1.status.code).to.equal(200);
      expect(reply1.events?.length).to.equal(3);
      expect(reply1.events![0].messageCid).to.equal(await Message.getCid(write2.message!));
      expect(reply1.events![1].messageCid).to.equal(await Message.getCid(write3.message!));
      expect(reply1.events![2].messageCid).to.equal(await Message.getCid(write4.message!));

      // testing `to` range
      const lastDayOf2022 = Time.createTimestamp({ year: 2022, month: 12, day: 31 });
      const eventsQuery2 = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ dateCreated: { to: lastDayOf2022 } }],
      });
      const reply2 = await dwn.processMessage(alice.did, eventsQuery2.message) as EventsQueryReply;
      expect(reply2.status.code).to.equal(200);
      expect(reply2.events?.length).to.equal(2);
      expect(reply2.events![0].messageCid).to.equal(await Message.getCid(write1.message!));
      expect(reply2.events![1].messageCid).to.equal(await Message.getCid(write2.message!));

      // testing `from` and `to` range
      const lastDayOf2023 = Time.createTimestamp({ year: 2023, month: 12, day: 31 });
      const eventsQuery3 = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ dateCreated: { from: lastDayOf2022, to: lastDayOf2023 } }],
      });
      const reply3 = await dwn.processMessage(alice.did, eventsQuery3.message) as EventsQueryReply;
      expect(reply3.status.code).to.equal(200);
      expect(reply3.events?.length).to.equal(1);
      expect(reply3.events![0].messageCid).to.equal(await Message.getCid(write3.message!));

      // testing edge case where value equals `from` and `to`
      const eventsQuery4 = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ dateCreated: { from: firstDayOf2022, to: firstDayOf2023 } }],
      });
      const reply4 = await dwn.processMessage(alice.did, eventsQuery4.message) as EventsQueryReply;
      expect(reply4.status.code).to.equal(200);
      expect(reply4.events?.length).to.equal(1);
      expect(reply4.events![0].messageCid).to.equal(await Message.getCid(write2.message!));
    });

    it('returns a 401 if tenant is not author', async () => {
      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();

      const { message } = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ schema: 'schema1' }]
      });
      const eventsQueryHandler = new EventsQueryHandler(didResolver, eventLog);
      const reply = await eventsQueryHandler.handle({ tenant: bob.did, message });

      expect(reply.status.code).to.equal(401);
      expect(reply.events).to.not.exist;
    });

    it('returns a 400 if message is invalid', async () => {
      const alice = await DidKeyResolver.generate();

      const { message } = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ schema: 'schema1' }]
      });
      (message['descriptor'] as any)['troll'] = 'hehe';

      const eventsQueryHandler = new EventsQueryHandler(didResolver, eventLog);
      const reply = await eventsQueryHandler.handle({ tenant: alice.did, message });

      expect(reply.status.code).to.equal(400);
      expect(reply.events).to.not.exist;
    });

    it('returns 400 if no filters are provided', async () => {
      const alice = await DidKeyResolver.generate();

      const { message } = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ schema: 'schema1' }],
      }); // create with filter to prevent failure on .create()
      message.descriptor.filters = []; // remove filters
      const eventsQueryHandler = new EventsQueryHandler(didResolver, eventLog);
      const reply = await eventsQueryHandler.handle({ tenant: alice.did, message });

      expect(reply.status.code).to.equal(400);
      expect(reply.events).to.not.exist;
    });

    it('returns 400 if an empty filter without properties is provided', async () => {
      const alice = await DidKeyResolver.generate();

      const { message } = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ schema: 'schema1' }],
      }); // create with filter to prevent failure on .create()
      message.descriptor.filters = [{}]; // empty out filter properties
      const eventsQueryHandler = new EventsQueryHandler(didResolver, eventLog);
      const reply = await eventsQueryHandler.handle({ tenant: alice.did, message });

      expect(reply.status.code).to.equal(400);
      expect(reply.events).to.not.exist;
    });
  });
}
