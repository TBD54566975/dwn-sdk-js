import type {
  DataStore,
  EventLog,
  MessageStore
} from '../../src/index.js';

import contributionReward from '../vectors/protocol-definitions/contribution-reward.json' assert { type: 'json' };
import { EventsQueryHandler } from '../../src/handlers/events-query.js';
import { expect } from 'chai';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStores } from '../test-stores.js';
import {
  DidKeyResolver,
  DidResolver,
  Dwn,
  DwnInterfaceName,
  DwnMethodName,
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

    it('filter for events matching a protocol across all message types', async () => {
      // scenario:
      // alice creates various (3) different message types all related to "proto1"
      // alice also creates a message that does not relate to "proto1".
      // when issuing an EventsQuery for the specific protocol, only Events related to it should be returned.
      // alice then creates additional records to query after a watermark

      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();
      // create a protocol
      const protoDefinition1 = { ...contributionReward };
      const protoConf1 = await TestDataGenerator.generateProtocolsConfigure({
        author             : alice,
        protocolDefinition : protoDefinition1
      });
      const proto1 = protoConf1.message.descriptor.definition.protocol;
      const protoConf1Response = await dwn.processMessage(alice.did, protoConf1.message);
      expect(protoConf1Response.status.code).equals(202);

      // create a record for the protocol
      const write1 = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'contribution', protocol: proto1, protocolPath: 'contribution' });
      const write1Response = await dwn.processMessage(alice.did, write1.message, write1.dataStream);
      expect(write1Response.status.code).equals(202);

      // create an unrelated record
      const unrelatedWrite = await TestDataGenerator.generateRecordsWrite({ author: alice });
      const unrelatedWriteResponse = await dwn.processMessage(alice.did, unrelatedWrite.message, unrelatedWrite.dataStream);
      expect(unrelatedWriteResponse.status.code).equals(202);

      // create a grant relating to the proto
      const grant1 = await TestDataGenerator.generatePermissionsGrant({
        author      : alice,
        grantedTo   : bob.did,
        dateExpires : '2023-12-12T12:12:12.121212Z',
        scope       : { protocol: proto1, interface: DwnInterfaceName.Records, method: DwnMethodName.Read }
      });

      const grant1Response = await dwn.processMessage(alice.did, grant1.message);
      expect(grant1Response.status.code).equals(202);

      // filter for proto1
      let proto1EventsQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ protocol: proto1 }]
      });
      let proto1EventsReply = await dwn.processMessage(alice.did, proto1EventsQuery.message);
      expect(proto1EventsReply.status.code).equals(200);
      expect(proto1EventsReply.events?.length).equals(3);

      // check order of events returned.
      expect(proto1EventsReply.events![0].messageCid).to.equal(await Message.getCid(protoConf1.message));
      expect(proto1EventsReply.events![1].messageCid).to.equal(await Message.getCid(write1.message));
      expect(proto1EventsReply.events![2].messageCid).to.equal(await Message.getCid(grant1.message));

      // get watermark of the last event and add more vents to query afterwards
      const watermark = proto1EventsReply.events![2].watermark;

      // revoke grant
      const grant1Id = await Message.getCid(grant1.message);
      const revokeForGrant = await TestDataGenerator.generatePermissionsRevoke({ author: alice, permissionsGrantId: grant1Id });
      const revokeForGrantResponse = await dwn.processMessage(alice.did, revokeForGrant.message);
      expect(revokeForGrantResponse.status.code).equals(202);

      // delete unrelated message
      const deleteUnrelated = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: unrelatedWrite.message.recordId });
      const deleteUnrelatedReply = await dwn.processMessage(alice.did, deleteUnrelated.message);
      expect(deleteUnrelatedReply.status.code).to.equal(202);

      // delete message
      const deleteMessage = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: write1.message.recordId });
      const deleteMessageReply = await dwn.processMessage(alice.did, deleteMessage.message);
      expect(deleteMessageReply.status.code).to.equal(202);

      //query messages beyond the watermark
      proto1EventsQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ protocol: proto1, watermark }]
      });
      proto1EventsReply = await dwn.processMessage(alice.did, proto1EventsQuery.message);
      expect(proto1EventsReply.status.code).equals(200);
      expect(proto1EventsReply.events?.length).equals(2);

      // check order of events returned
      expect(proto1EventsReply.events![0].messageCid).to.equal(await Message.getCid(revokeForGrant.message));
      expect(proto1EventsReply.events![1].messageCid).to.equal(await Message.getCid(deleteMessage.message));
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
      let eventsQuery1 = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ dateCreated: { from: lastDayOf2021 } }],
      });
      let reply1 = await dwn.processMessage(alice.did, eventsQuery1.message);
      expect(reply1.status.code).to.equal(200);
      expect(reply1.events?.length).to.equal(3);
      expect(reply1.events![0].messageCid).to.equal(await Message.getCid(write2.message!));
      expect(reply1.events![1].messageCid).to.equal(await Message.getCid(write3.message!));
      expect(reply1.events![2].messageCid).to.equal(await Message.getCid(write4.message!));

      // using the watermark of the first message
      eventsQuery1 = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ dateCreated: { from: lastDayOf2021 }, watermark: reply1.events![0].watermark }],
      });
      reply1 = await dwn.processMessage(alice.did, eventsQuery1.message);
      expect(reply1.status.code).to.equal(200);
      expect(reply1.events?.length).to.equal(2);
      expect(reply1.events![0].messageCid).to.equal(await Message.getCid(write3.message!));
      expect(reply1.events![1].messageCid).to.equal(await Message.getCid(write4.message!));

      // testing `to` range
      const lastDayOf2022 = Time.createTimestamp({ year: 2022, month: 12, day: 31 });
      let eventsQuery2 = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ dateCreated: { to: lastDayOf2022 } }],
      });
      let reply2 = await dwn.processMessage(alice.did, eventsQuery2.message);
      expect(reply2.status.code).to.equal(200);
      expect(reply2.events?.length).to.equal(2);
      expect(reply2.events![0].messageCid).to.equal(await Message.getCid(write1.message!));
      expect(reply2.events![1].messageCid).to.equal(await Message.getCid(write2.message!));

      // using the watermark of the first message
      eventsQuery2 = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ dateCreated: { to: lastDayOf2022 }, watermark: reply2.events![0].watermark }],
      });
      reply2 = await dwn.processMessage(alice.did, eventsQuery2.message);
      expect(reply2.status.code).to.equal(200);
      expect(reply2.events?.length).to.equal(1);
      expect(reply2.events![0].messageCid).to.equal(await Message.getCid(write2.message!));

      // testing `from` and `to` range
      const lastDayOf2023 = Time.createTimestamp({ year: 2023, month: 12, day: 31 });
      let eventsQuery3 = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ dateCreated: { from: lastDayOf2022, to: lastDayOf2023 } }],
      });
      let reply3 = await dwn.processMessage(alice.did, eventsQuery3.message);
      expect(reply3.status.code).to.equal(200);
      expect(reply3.events?.length).to.equal(1);
      expect(reply3.events![0].messageCid).to.equal(await Message.getCid(write3.message!));

      // using the watermark of the only message, should not return any results
      eventsQuery3 = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ dateCreated: { from: lastDayOf2022, to: lastDayOf2023 }, watermark: reply3.events![0].watermark }],
      });
      reply3 = await dwn.processMessage(alice.did, eventsQuery3.message);
      expect(reply3.status.code).to.equal(200);
      expect(reply3.events?.length).to.equal(0);

      // testing edge case where value equals `from` and `to`
      let eventsQuery4 = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ dateCreated: { from: firstDayOf2022, to: firstDayOf2023 } }],
      });
      let reply4 = await dwn.processMessage(alice.did, eventsQuery4.message);
      expect(reply4.status.code).to.equal(200);
      expect(reply4.events?.length).to.equal(1);
      expect(reply4.events![0].messageCid).to.equal(await Message.getCid(write2.message!));

      // testing edge case where value equals `from` and `to`
      eventsQuery4 = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ dateCreated: { from: firstDayOf2022, to: firstDayOf2023 }, watermark: reply4.events![0].watermark }],
      });
      reply4 = await dwn.processMessage(alice.did, eventsQuery4.message);
      expect(reply4.status.code).to.equal(200);
      expect(reply4.events?.length).to.equal(0);
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
