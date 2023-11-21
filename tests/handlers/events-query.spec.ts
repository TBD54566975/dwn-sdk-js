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
      // alice creates (3) different message types all related to "proto1" (Configure, RecordsWrite, Grant)
      // alice creates (3) different message types all related to "proto2" (Configure, RecordsWrite, Grant)
      // when issuing an EventsQuery for the specific protocol, only Events related to it should be returned.
      // alice then creates additional records to query after a cursor

      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();

      // create a proto1
      const protoConf1 = await TestDataGenerator.generateProtocolsConfigure({
        author             : alice,
        protocolDefinition : { ...contributionReward, protocol: 'proto1' }
      });
      const proto1 = protoConf1.message.descriptor.definition.protocol;
      const protoConf1Response = await dwn.processMessage(alice.did, protoConf1.message);
      expect(protoConf1Response.status.code).equals(202);

      // create a proto2
      const protoConf2 = await TestDataGenerator.generateProtocolsConfigure({
        author             : alice,
        protocolDefinition : { ...contributionReward, protocol: 'proto2' }
      });
      const proto2 = protoConf2.message.descriptor.definition.protocol;
      const protoConf2Response = await dwn.processMessage(alice.did, protoConf2.message);
      expect(protoConf2Response.status.code).equals(202);

      // create a record for proto1
      const write1proto1 = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'contribution', protocol: proto1, protocolPath: 'contribution' });
      const write1Response = await dwn.processMessage(alice.did, write1proto1.message, write1proto1.dataStream);
      expect(write1Response.status.code).equals(202);

      // create a record for proto2
      const write1proto2 = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'contribution', protocol: proto2, protocolPath: 'contribution' });
      const write1Proto2Response = await dwn.processMessage(alice.did, write1proto2.message, write1proto2.dataStream);
      expect(write1Proto2Response.status.code).equals(202);

      // create a grant relating to proto1
      const grant1Proto1 = await TestDataGenerator.generatePermissionsGrant({
        author      : alice,
        grantedTo   : bob.did,
        dateExpires : '2055-12-12T12:12:12.121212Z',
        scope       : { protocol: proto1, interface: DwnInterfaceName.Records, method: DwnMethodName.Read }
      });

      const grant1Response = await dwn.processMessage(alice.did, grant1Proto1.message);
      expect(grant1Response.status.code).equals(202);

      // create a grant relating to proto2
      const grant1Proto2 = await TestDataGenerator.generatePermissionsGrant({
        author      : alice,
        grantedTo   : bob.did,
        dateExpires : '2055-12-12T12:12:12.121212Z',
        scope       : { protocol: proto2, interface: DwnInterfaceName.Records, method: DwnMethodName.Read }
      });

      const grant1Proto2Response = await dwn.processMessage(alice.did, grant1Proto2.message);
      expect(grant1Proto2Response.status.code).equals(202);

      // filter for proto1
      let proto1EventsQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ protocol: proto1 }]
      });
      let proto1EventsReply = await dwn.processMessage(alice.did, proto1EventsQuery.message);
      expect(proto1EventsReply.status.code).equals(200);
      expect(proto1EventsReply.events?.length).equals(3);

      // check order of events returned.
      expect(proto1EventsReply.events![0]).to.equal(await Message.getCid(protoConf1.message));
      expect(proto1EventsReply.events![1]).to.equal(await Message.getCid(write1proto1.message));
      expect(proto1EventsReply.events![2]).to.equal(await Message.getCid(grant1Proto1.message));

      // filter for proto2
      let proto2EventsQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ protocol: proto2 }]
      });
      let proto2EventsReply = await dwn.processMessage(alice.did, proto2EventsQuery.message);
      expect(proto2EventsReply.status.code).equals(200);
      expect(proto2EventsReply.events?.length).equals(3);

      // check order of events returned.
      expect(proto2EventsReply.events![0]).to.equal(await Message.getCid(protoConf2.message));
      expect(proto2EventsReply.events![1]).to.equal(await Message.getCid(write1proto2.message));
      expect(proto2EventsReply.events![2]).to.equal(await Message.getCid(grant1Proto2.message));

      // get cursor of the last event and add more events to query afterwards
      const proto1Cursor = proto1EventsReply.events![2];
      const proto2Cursor = proto2EventsReply.events![2];

      // revoke grant proto 1
      const grant1proto1Id = await Message.getCid(grant1Proto1.message);
      const revokeForGrantProto1 = await TestDataGenerator.generatePermissionsRevoke({ author: alice, permissionsGrantId: grant1proto1Id });
      const revokeForGrantResponse = await dwn.processMessage(alice.did, revokeForGrantProto1.message);
      expect(revokeForGrantResponse.status.code).equals(202);

      // revoke grant proto 2
      const grant1proto2Id = await Message.getCid(grant1Proto2.message);
      const revokeForGrantProto2 = await TestDataGenerator.generatePermissionsRevoke({ author: alice, permissionsGrantId: grant1proto2Id });
      const revokeForGrantProto2Response = await dwn.processMessage(alice.did, revokeForGrantProto2.message);
      expect(revokeForGrantProto2Response.status.code).equals(202);

      // delete proto1 message
      const deleteProto1Message = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: write1proto1.message.recordId });
      const deleteProto1MessageReply = await dwn.processMessage(alice.did, deleteProto1Message.message);
      expect(deleteProto1MessageReply.status.code).to.equal(202);

      // delete proto2 message
      const deleteProto2Message = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: write1proto2.message.recordId });
      const deleteProto2MessageReply = await dwn.processMessage(alice.did, deleteProto2Message.message);
      expect(deleteProto2MessageReply.status.code).to.equal(202);

      //query messages beyond the cursor
      proto1EventsQuery = await TestDataGenerator.generateEventsQuery({
        cursor  : proto1Cursor,
        author  : alice,
        filters : [{ protocol: proto1 }],
      });
      proto1EventsReply = await dwn.processMessage(alice.did, proto1EventsQuery.message);
      expect(proto1EventsReply.status.code).equals(200);
      expect(proto1EventsReply.events?.length).equals(2);

      // check order of events returned
      expect(proto1EventsReply.events![0]).to.equal(await Message.getCid(revokeForGrantProto1.message));
      expect(proto1EventsReply.events![1]).to.equal(await Message.getCid(deleteProto1Message.message));

      //query messages beyond the cursor
      proto2EventsQuery = await TestDataGenerator.generateEventsQuery({
        cursor  : proto2Cursor,
        author  : alice,
        filters : [{ protocol: proto2 }],
      });
      proto2EventsReply = await dwn.processMessage(alice.did, proto2EventsQuery.message);
      expect(proto2EventsReply.status.code).equals(200);
      expect(proto2EventsReply.events?.length).equals(2);

      // check order of events returned
      expect(proto2EventsReply.events![0]).to.equal(await Message.getCid(revokeForGrantProto2.message));
      expect(proto2EventsReply.events![1]).to.equal(await Message.getCid(deleteProto2Message.message));
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
      expect(reply1.events![0]).to.equal(await Message.getCid(write2.message!));
      expect(reply1.events![1]).to.equal(await Message.getCid(write3.message!));
      expect(reply1.events![2]).to.equal(await Message.getCid(write4.message!));

      // using the cursor of the first message
      eventsQuery1 = await TestDataGenerator.generateEventsQuery({
        cursor  : reply1.events![0],
        author  : alice,
        filters : [{ dateCreated: { from: lastDayOf2021 } }],
      });
      reply1 = await dwn.processMessage(alice.did, eventsQuery1.message);
      expect(reply1.status.code).to.equal(200);
      expect(reply1.events?.length).to.equal(2);
      expect(reply1.events![0]).to.equal(await Message.getCid(write3.message!));
      expect(reply1.events![1]).to.equal(await Message.getCid(write4.message!));

      // testing `to` range
      const lastDayOf2022 = Time.createTimestamp({ year: 2022, month: 12, day: 31 });
      let eventsQuery2 = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ dateCreated: { to: lastDayOf2022 } }],
      });
      let reply2 = await dwn.processMessage(alice.did, eventsQuery2.message);
      expect(reply2.status.code).to.equal(200);
      expect(reply2.events?.length).to.equal(2);
      expect(reply2.events![0]).to.equal(await Message.getCid(write1.message!));
      expect(reply2.events![1]).to.equal(await Message.getCid(write2.message!));

      // using the cursor of the first message
      eventsQuery2 = await TestDataGenerator.generateEventsQuery({
        cursor  : reply2.events![0],
        author  : alice,
        filters : [{ dateCreated: { to: lastDayOf2022 } }],
      });
      reply2 = await dwn.processMessage(alice.did, eventsQuery2.message);
      expect(reply2.status.code).to.equal(200);
      expect(reply2.events?.length).to.equal(1);
      expect(reply2.events![0]).to.equal(await Message.getCid(write2.message!));

      // testing `from` and `to` range
      const lastDayOf2023 = Time.createTimestamp({ year: 2023, month: 12, day: 31 });
      let eventsQuery3 = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ dateCreated: { from: lastDayOf2022, to: lastDayOf2023 } }],
      });
      let reply3 = await dwn.processMessage(alice.did, eventsQuery3.message);
      expect(reply3.status.code).to.equal(200);
      expect(reply3.events?.length).to.equal(1);
      expect(reply3.events![0]).to.equal(await Message.getCid(write3.message!));

      // using the cursor of the only message, should not return any results
      eventsQuery3 = await TestDataGenerator.generateEventsQuery({
        cursor  : reply3.events![0],
        author  : alice,
        filters : [{ dateCreated: { from: lastDayOf2022, to: lastDayOf2023 } }],
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
      expect(reply4.events![0]).to.equal(await Message.getCid(write2.message!));

      // testing edge case where value equals `from` and `to`
      eventsQuery4 = await TestDataGenerator.generateEventsQuery({
        cursor  : reply4.events![0],
        author  : alice,
        filters : [{ dateCreated: { from: firstDayOf2022, to: firstDayOf2023 } }],
      });
      reply4 = await dwn.processMessage(alice.did, eventsQuery4.message);
      expect(reply4.status.code).to.equal(200);
      expect(reply4.events?.length).to.equal(0);
    });

    it('returns events filtered by a given author', async () => {
      // scenario: alice and bob both write messages to alice's DWN
      //           alice is able to filter for events by author across different message types

      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();

      // create a proto1
      const protoConf = await TestDataGenerator.generateProtocolsConfigure({
        author             : alice,
        protocolDefinition : { ...contributionReward, protocol: 'proto1' }
      });
      const protoConfResponse = await dwn.processMessage(alice.did, protoConf.message);
      expect(protoConfResponse.status.code).equals(202);

      // alice writes a message
      const aliceWrite1 = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'contribution', protocol: 'proto1', protocolPath: 'contribution' });
      const aliceWrite1Response = await dwn.processMessage(alice.did, aliceWrite1.message, aliceWrite1.dataStream);
      expect(aliceWrite1Response.status.code).equals(202);

      // bob writes messages
      const bobWrite1 = await TestDataGenerator.generateRecordsWrite({ author: bob, schema: 'contribution', protocol: 'proto1', protocolPath: 'contribution' });
      const bobWrite1Response = await dwn.processMessage(alice.did, bobWrite1.message, bobWrite1.dataStream);
      expect(bobWrite1Response.status.code).equals(202);

      const bobWrite2 = await TestDataGenerator.generateRecordsWrite({ author: bob, schema: 'contribution', protocol: 'proto1', protocolPath: 'contribution' });
      const bobWrite2Response = await dwn.processMessage(alice.did, bobWrite2.message, bobWrite2.dataStream);
      expect(bobWrite2Response.status.code).equals(202);

      // alice writes another message
      const aliceWrite2 = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'contribution', protocol: 'proto1', protocolPath: 'contribution' });
      const aliceWrite2Response = await dwn.processMessage(alice.did, aliceWrite2.message, aliceWrite2.dataStream);
      expect(aliceWrite2Response.status.code).equals(202);

      // alice queries for events authored by alice
      let aliceEvents = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ author: alice.did }],
      });
      let aliceEventsReply = await dwn.processMessage(alice.did, aliceEvents.message);
      expect(aliceEventsReply.status.code).to.equal(200);
      expect(aliceEventsReply.events?.length).to.equal(3);
      const aliceProtocolCid = await Message.getCid(protoConf.message);
      const aliceWrite1Cid = await Message.getCid(aliceWrite1.message);
      const aliceWrite2Cid = await Message.getCid(aliceWrite2.message);
      expect(aliceEventsReply.events).to.eql([ aliceProtocolCid, aliceWrite1Cid, aliceWrite2Cid ]);

      // alice queries for events authored by bob
      const bobsEvents = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ author: bob.did }],
      });
      const bobsEventsReply = await dwn.processMessage(alice.did, bobsEvents.message);
      expect(bobsEventsReply.status.code).to.equal(200);
      expect(bobsEventsReply.events?.length).to.equal(2);
      const bobWrite1Cid = await Message.getCid(bobWrite1.message);
      const bobWrite2Cid = await Message.getCid(bobWrite2.message);
      expect(bobsEventsReply.events).to.eql([ bobWrite1Cid, bobWrite2Cid ]);

      // alice writes another message
      const aliceWrite3 = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'contribution', protocol: 'proto1', protocolPath: 'contribution' });
      const aliceWrite3Response = await dwn.processMessage(alice.did, aliceWrite3.message, aliceWrite3.dataStream);
      expect(aliceWrite3Response.status.code).equals(202);

      // bob writes another message
      const bobWrite3 = await TestDataGenerator.generateRecordsWrite({ author: bob, schema: 'contribution', protocol: 'proto1', protocolPath: 'contribution' });
      const bobWrite3Response = await dwn.processMessage(alice.did, bobWrite3.message, bobWrite3.dataStream);
      expect(bobWrite3Response.status.code).equals(202);

      // alice issues a grant
      const grant = await TestDataGenerator.generatePermissionsGrant({ author: alice });
      const grantResponse = await dwn.processMessage(alice.did, grant.message);
      const grantId = await Message.getCid(grant.message);
      expect(grantResponse.status.code).to.equal(202);

      // alice revokes grant
      const grantRevoke = await TestDataGenerator.generatePermissionsRevoke({ author: alice, permissionsGrantId: grantId });
      const grantRevokeResponse = await dwn.processMessage(alice.did, grantRevoke.message);
      expect(grantRevokeResponse.status.code).to.equal(202);

      // alice configures another protocol
      const protoConf2 = await TestDataGenerator.generateProtocolsConfigure({
        author             : alice,
        protocolDefinition : { ...contributionReward, protocol: 'proto2' }
      });
      const protoConf2Response = await dwn.processMessage(alice.did, protoConf2.message);
      expect(protoConf2Response.status.code).equals(202);

      // query events after cursor
      aliceEvents = await TestDataGenerator.generateEventsQuery({
        cursor  : aliceWrite2Cid,
        author  : alice,
        filters : [{ author: alice.did }],
      });
      aliceEventsReply = await dwn.processMessage(alice.did, aliceEvents.message);
      expect(aliceEventsReply.status.code).to.equal(200);
      expect(aliceEventsReply.events?.length).to.equal(4);
      expect(aliceEventsReply.events).to.eql([
        await Message.getCid(aliceWrite3.message),
        grantId,
        await Message.getCid(grantRevoke.message),
        await Message.getCid(protoConf2.message),
      ]);
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
