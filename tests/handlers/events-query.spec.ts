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

import { EventsQueryHandler } from '../../src/handlers/events-query.js';
import { expect } from 'chai';
import freeForAll from '../vectors/protocol-definitions/free-for-all.json' assert { type: 'json' };
import { Message } from '../../src/core/message.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { DidKey, UniversalResolver } from '@web5/dids';
import { Dwn, DwnErrorCode, DwnInterfaceName, DwnMethodName } from '../../src/index.js';


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
        author: alice,
      });
      const eventsQueryHandler = new EventsQueryHandler(didResolver, messageStore, eventLog);
      const reply = await eventsQueryHandler.handle({ tenant: bob.did, message });

      expect(reply.status.code).to.equal(401);
      expect(reply.entries).to.not.exist;
    });

    it('returns a 400 if message is invalid', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();

      const { message } = await TestDataGenerator.generateEventsQuery({
        author: alice,
      });
      (message['descriptor'] as any)['troll'] = 'hehe';

      const eventsQueryHandler = new EventsQueryHandler(didResolver, messageStore, eventLog);
      const reply = await eventsQueryHandler.handle({ tenant: alice.did, message });

      expect(reply.status.code).to.equal(400);
      expect(reply.entries).to.not.exist;
    });

    it('returns 400 if an empty filter without properties is provided', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();

      const { message } = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ protocol: 'http://example.org/protocol/v1' }],
      }); // create with filter to prevent failure on .create()
      message.descriptor.filters = [{}]; // empty out filter properties
      const eventsQueryHandler = new EventsQueryHandler(didResolver, messageStore, eventLog);
      const reply = await eventsQueryHandler.handle({ tenant: alice.did, message });

      expect(reply.status.code).to.equal(400);
      expect(reply.entries).to.not.exist;
    });

    it('returns all events for a tenant beyond a provided cursor', async () => {
      // scenario: Alice configures a protocol, and writes 5 records.
      // Alice queries for events without a cursor, and expects to see all 5 records as well as the protocol configuration message.
      // Alice writes an additional record.
      // Alice queries for events beyond the cursor, and expects to see only the additional record.

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

    describe('grant based queries', () => {
      it('allows query of events with matching interface and method grant scope', async () => {
        // scenario: Alice gives Bob permission to query for all of her events
        // Alice writes various messages
        // When Bob queries for events, he should see all of Alice's messages including his own grant

        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        // create grant that is scoped to `EventsQuery` for bob
        const { message: grantMessage, dataStream } = await TestDataGenerator.generateGrantCreate({
          author    : alice,
          grantedTo : bob,
          scope     : {
            interface : DwnInterfaceName.Events,
            method    : DwnMethodName.Query
          }
        });
        const grantReply = await dwn.processMessage(alice.did, grantMessage, { dataStream });
        expect(grantReply.status.code).to.equal(202);

        // configure the freeForAll protocol
        const { message: freeForAllConfigure } = await TestDataGenerator.generateProtocolsConfigure({
          author             : alice,
          protocolDefinition : freeForAll,
        });
        const { status: freeForAllReplyStatus } = await dwn.processMessage(alice.did, freeForAllConfigure);
        expect(freeForAllReplyStatus.code).to.equal(202);

        // configure a random protocol configuration
        const { message: protocolMessage } = await TestDataGenerator.generateProtocolsConfigure({
          author: alice,
        });
        const { status: configureStatus } = await dwn.processMessage(alice.did, protocolMessage);
        expect(configureStatus.code).to.equal(202);

        // write a message to the Records free for all interface
        const { message: recordMessage, dataStream: recordDataStream } = await TestDataGenerator.generateRecordsWrite({
          protocol     : freeForAll.protocol,
          protocolPath : 'post',
          schema       : freeForAll.types.post.schema,
          author       : alice
        });

        const recordReply = await dwn.processMessage(alice.did, recordMessage, { dataStream: recordDataStream });
        expect(recordReply.status.code).to.equal(202);

        // write a random message
        const { message: randomMessage, dataStream: randomDataStream } = await TestDataGenerator.generateRecordsWrite({
          author: alice
        });
        const randomReply = await dwn.processMessage(alice.did, randomMessage, { dataStream: randomDataStream });
        expect(randomReply.status.code).to.equal(202);

        // bob uses the grant to query for all of these messages
        const { message: bobQuery } = await TestDataGenerator.generateEventsQuery({
          author            : bob,
          permissionGrantId : grantMessage.recordId
        });
        const bobReply = await dwn.processMessage(alice.did, bobQuery);
        expect(bobReply.status.code).to.equal(200);
        expect(bobReply.entries!.length).to.equal(5);
        expect(bobReply.entries).to.have.members([
          await Message.getCid(grantMessage),
          await Message.getCid(freeForAllConfigure),
          await Message.getCid(protocolMessage),
          await Message.getCid(recordMessage),
          await Message.getCid(randomMessage),
        ]);
      });

      it('rejects query of events with mismatching interface grant scope', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        // create grant that is scoped to `RecordsWrite` for bob scoped to the `freeForAll` protocol
        const { message: grantMessage, dataStream } = await TestDataGenerator.generateGrantCreate({
          author    : alice,
          grantedTo : bob,
          scope     : {
            interface : DwnInterfaceName.Records,
            method    : DwnMethodName.Write,
            protocol  : freeForAll.protocol
          }
        });
        const grantReply = await dwn.processMessage(alice.did, grantMessage, { dataStream });
        expect(grantReply.status.code).to.equal(202);

        // bob attempts to use the `RecordsWrite` grant on an `EventsQuery` message
        const { message: bobQuery } = await TestDataGenerator.generateEventsQuery({
          author            : bob,
          permissionGrantId : grantMessage.recordId
        });
        const bobReply = await dwn.processMessage(alice.did, bobQuery);
        expect(bobReply.status.code).to.equal(401);
        expect(bobReply.status.detail).to.include(DwnErrorCode.GrantAuthorizationInterfaceMismatch);
      });

      xit('rejects query of events with mismatching method grant scopes', async () => {
      });

      describe('protocol records', () => {
        it('allows query of protocol messages with matching protocol grant scopes', async () => {

          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          // install protocol 1
          const protocol1: ProtocolDefinition = { ...freeForAll, published: true, protocol: 'http://protcol1' };
          const { message: protocol1Configure } = await TestDataGenerator.generateProtocolsConfigure({
            author             : alice,
            protocolDefinition : protocol1,
          });
          const { status: protocol1ConfigureStatus } = await dwn.processMessage(alice.did, protocol1Configure);
          expect(protocol1ConfigureStatus.code).to.equal(202);

          // install protocol 2
          const protocol2: ProtocolDefinition = { ...freeForAll, published: true, protocol: 'http://protcol2' };
          const { message: protocol2Configure } = await TestDataGenerator.generateProtocolsConfigure({
            author             : alice,
            protocolDefinition : protocol2,
          });
          const { status: protocol2ConfigureStatus } = await dwn.processMessage(alice.did, protocol2Configure);
          expect(protocol2ConfigureStatus.code).to.equal(202);

          // grant bob permission to query for protocol 1
          const { message: grant1Message, dataStream: grant1DataStream } = await TestDataGenerator.generateGrantCreate({
            author    : alice,
            grantedTo : bob,
            scope     : {
              interface : DwnInterfaceName.Events,
              method    : DwnMethodName.Query,
              protocol  : protocol1.protocol
            }
          });

          const grant1Reply = await dwn.processMessage(alice.did, grant1Message, { dataStream: grant1DataStream });
          expect(grant1Reply.status.code).to.equal(202);

          // bob uses the grant to query for protocol 1 messages
          const { message: bobQuery1 } = await TestDataGenerator.generateEventsQuery({
            author            : bob,
            filters           : [{ protocol: protocol1.protocol }],
            permissionGrantId : grant1Message.recordId
          });
          const bobReply1 = await dwn.processMessage(alice.did, bobQuery1);
          expect(bobReply1.status.code).to.equal(200);

          expect(bobReply1.entries!.length).to.equal(2); // protocol1Configure, and bob's grant
          expect(bobReply1.entries).to.have.members([
            await Message.getCid(protocol1Configure),
            await Message.getCid(grant1Message)
          ]);
        });

        it('rejects query of protocol messages with mismatching protocol grant scopes', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          // install protocol 1
          const protocol1: ProtocolDefinition = { ...freeForAll, published: true, protocol: 'http://protcol1' };
          const { message: protocol1Configure } = await TestDataGenerator.generateProtocolsConfigure({
            author             : alice,
            protocolDefinition : protocol1,
          });
          const { status: protocol1ConfigureStatus } = await dwn.processMessage(alice.did, protocol1Configure);
          expect(protocol1ConfigureStatus.code).to.equal(202);

          // install protocol 2
          const protocol2: ProtocolDefinition = { ...freeForAll, published: true, protocol: 'http://protcol2' };
          const { message: protocol2Configure } = await TestDataGenerator.generateProtocolsConfigure({
            author             : alice,
            protocolDefinition : protocol2,
          });
          const { status: protocol2ConfigureStatus } = await dwn.processMessage(alice.did, protocol2Configure);
          expect(protocol2ConfigureStatus.code).to.equal(202);

          // grant bob permission to query for protocol 1
          const { message: grant1Message, dataStream: grant1DataStream } = await TestDataGenerator.generateGrantCreate({
            author    : alice,
            grantedTo : bob,
            scope     : {
              interface : DwnInterfaceName.Events,
              method    : DwnMethodName.Query,
              protocol  : protocol1.protocol
            }
          });

          const grant1Reply = await dwn.processMessage(alice.did, grant1Message, { dataStream: grant1DataStream });
          expect(grant1Reply.status.code).to.equal(202);

          // bob uses the grant for protocol 1 to query for protocol 2 messages
          const { message: bobQuery1 } = await TestDataGenerator.generateEventsQuery({
            author            : bob,
            filters           : [{ protocol: protocol2.protocol }],
            permissionGrantId : grant1Message.recordId
          });
          const bobReply1 = await dwn.processMessage(alice.did, bobQuery1);
          expect(bobReply1.status.code).to.equal(401);
          expect(bobReply1.status.detail).to.include(DwnErrorCode.EventsGrantAuthorizationMismatchedProtocol);
          expect(bobReply1.entries).to.not.exist;

          // bob attempts to use the grant for protocol 1 to query for messages in protocol 1 OR protocol 2 given two filters
          // this should fail because the grant is scoped to protocol 1 only
          const { message: bobQuery2 } = await TestDataGenerator.generateEventsQuery({
            author            : bob,
            filters           : [{ protocol: protocol1.protocol }, { protocol: protocol2.protocol }],
            permissionGrantId : grant1Message.recordId
          });
          const bobReply2 = await dwn.processMessage(alice.did, bobQuery2);
          expect(bobReply2.status.code).to.equal(401);
          expect(bobReply2.status.detail).to.include(DwnErrorCode.EventsGrantAuthorizationMismatchedProtocol);
          expect(bobReply2.entries).to.not.exist;
        });
      });
    });
  });
}
