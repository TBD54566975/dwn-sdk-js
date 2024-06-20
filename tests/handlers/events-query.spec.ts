import type { DidResolver } from '@web5/dids';
import type { EventsQueryReply } from '../../src/types/events-types.js';
import type {
  DataStore,
  EventLog,
  EventStream,
  MessageStore,
  ProtocolDefinition,
  ResumableTaskStore,
} from '../../src/index.js';

import { Dwn } from '../../src/index.js';
import { EventsQueryHandler } from '../../src/handlers/events-query.js';
import { expect } from 'chai';
import freeForAll from '../vectors/protocol-definitions/free-for-all.json' assert { type: 'json' };
import { Message } from '../../src/core/message.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { DidKey, UniversalResolver } from '@web5/dids';


export function testEventsQueryHandler(): void {
  describe('EventsQueryHandler.handle()', () => {
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let resumableTaskStore: ResumableTaskStore;
    let eventLog: EventLog;
    let eventStream: EventStream;
    let dwn: Dwn;

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

    it('returns all events for a tenant if cursor is not provided', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const expectedCids: string[] = [];

      const protocolDefinition: ProtocolDefinition = { ...freeForAll, published: true };

      // write a protocol configuration
      const { message: protocolMessage } = await TestDataGenerator.generateProtocolsConfigure({
        author: alice,
        protocolDefinition,
      });
      const { status: configureStatus } = await dwn.processMessage(alice.did, protocolMessage);
      expect(configureStatus.code).to.equal(202);
      expectedCids.push(await Message.getCid(protocolMessage));

      for (let i = 0; i < 5; i += 1) {
        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({
          protocol     : protocolDefinition.protocol,
          protocolPath : 'post',
          schema       : protocolDefinition.types.post.schema,
          author       : alice
        });
        const reply = await dwn.processMessage(alice.did, message, { dataStream });

        expect(reply.status.code).to.equal(202);
        const messageCid = await Message.getCid(message);
        expectedCids.push(messageCid);
      }

      const { message } = await TestDataGenerator.generateEventsQuery({ author: alice });
      const reply: EventsQueryReply = await dwn.processMessage(alice.did, message);

      expect(reply.status.code).to.equal(200);
      expect((reply as any).data).to.not.exist;
      expect(reply.entries?.length).to.equal(expectedCids.length);

      for (let i = 0; i < reply.entries!.length; i += 1) {
        expect(reply.entries![i]).to.equal(expectedCids[i]);
      }

      // write an additional message
      const { message: additionalMessage, dataStream: additionalDataStream } = await TestDataGenerator.generateRecordsWrite({
        protocol     : protocolDefinition.protocol,
        protocolPath : 'post',
        schema       : protocolDefinition.types.post.schema,
        author       : alice
      });
      const additionalReply = await dwn.processMessage(alice.did, additionalMessage, { dataStream: additionalDataStream });
      expect(additionalReply.status.code).to.equal(202);

      // query for events beyond the cursor
      const { message: messagesAfterCursor } = await TestDataGenerator.generateEventsQuery({ author: alice, cursor: reply.cursor });
      const afterCursorReply = await dwn.processMessage(alice.did, messagesAfterCursor);
      expect(afterCursorReply.status.code).to.equal(200);
      expect(afterCursorReply.entries!.length).to.equal(1);
      expect(afterCursorReply.entries![0]).to.equal(await Message.getCid(additionalMessage));
    });
  });
}
