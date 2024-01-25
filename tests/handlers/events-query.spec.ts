import type {
  DataStore,
  EventLog,
  EventStream,
  MessageStore
} from '../../src/index.js';

import { Dwn } from '../../src/index.js';
import { EventsQueryHandler } from '../../src/handlers/events-query.js';
import { expect } from 'chai';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { DidKeyMethod, DidResolver } from '@web5/dids';


export function testEventsQueryHandler(): void {
  describe('EventsQueryHandler.handle()', () => {
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let eventLog: EventLog;
    let eventStream: EventStream;
    let dwn: Dwn;

    // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
    // so that different test suites can reuse the same backend store for testing
    before(async () => {
      didResolver = new DidResolver({ didResolvers: [DidKeyMethod] });

      const stores = TestStores.get();
      messageStore = stores.messageStore;
      dataStore = stores.dataStore;
      eventLog = stores.eventLog;
      eventStream = TestEventStream.get();

      dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog, eventStream });
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
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();

      const { message } = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ schema: 'schema1' }]
      });
      const eventsQueryHandler = new EventsQueryHandler(didResolver, eventLog);
      const reply = await eventsQueryHandler.handle({ tenant: bob.did, message });

      expect(reply.status.code).to.equal(401);
      expect(reply.entries).to.not.exist;
    });

    it('returns a 400 if message is invalid', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();

      const { message } = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ schema: 'schema1' }]
      });
      (message['descriptor'] as any)['troll'] = 'hehe';

      const eventsQueryHandler = new EventsQueryHandler(didResolver, eventLog);
      const reply = await eventsQueryHandler.handle({ tenant: alice.did, message });

      expect(reply.status.code).to.equal(400);
      expect(reply.entries).to.not.exist;
    });

    it('returns 400 if no filters are provided', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();

      const { message } = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ schema: 'schema1' }],
      }); // create with filter to prevent failure on .create()
      message.descriptor.filters = []; // remove filters
      const eventsQueryHandler = new EventsQueryHandler(didResolver, eventLog);
      const reply = await eventsQueryHandler.handle({ tenant: alice.did, message });

      expect(reply.status.code).to.equal(400);
      expect(reply.entries).to.not.exist;
    });

    it('returns 400 if an empty filter without properties is provided', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();

      const { message } = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ schema: 'schema1' }],
      }); // create with filter to prevent failure on .create()
      message.descriptor.filters = [{}]; // empty out filter properties
      const eventsQueryHandler = new EventsQueryHandler(didResolver, eventLog);
      const reply = await eventsQueryHandler.handle({ tenant: alice.did, message });

      expect(reply.status.code).to.equal(400);
      expect(reply.entries).to.not.exist;
    });
  });
}
