import type {
  DataStore,
  EventLog,
  EventStream,
  MessageStore
} from '../../src/index.js';

import freeForAll from '../vectors/protocol-definitions/free-for-all.json' assert { type: 'json' };
import threadProtocol from '../vectors/protocol-definitions/thread-role.json' assert { type: 'json' };

import { TestStores } from '../test-stores.js';
import { DidKeyResolver, DidResolver, Dwn, DwnConstant, DwnInterfaceName, DwnMethodName, Message, Time } from '../../src/index.js';

import { expect } from 'chai';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';

export function testEventsQueryScenarios(): void {
  describe('events query tests', () => {
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let eventLog: EventLog;
    let eventStream: EventStream;
    let dwn: Dwn;

    // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
    // so that different test suites can reuse the same backend store for testing
    before(async () => {
      didResolver = new DidResolver([new DidKeyResolver()]);

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

    it('supports multiple filter types', async () => {
      const alice = await DidKeyResolver.generate();
      const record = await TestDataGenerator.generateRecordsWrite({ author: alice });
      const grant = await TestDataGenerator.generatePermissionsGrant({ author: alice });
      const protocol = await TestDataGenerator.generateProtocolsConfigure({ author: alice });

      // insert data
      const recordReply = await dwn.processMessage(alice.did, record.message, { dataStream: record.dataStream });
      const grantReply = await dwn.processMessage(alice.did, grant.message);
      const protocolReply = await dwn.processMessage(alice.did, protocol.message);
      expect(recordReply.status.code).to.equal(202, 'RecordsWrite');
      expect(grantReply.status.code).to.equal(202, 'PermissionsGrant');
      expect(protocolReply.status.code).to.equal(202, 'ProtocolConfigure');

      const eventsQueryRecords = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [
          { interface: DwnInterfaceName.Permissions }, // PermissionsGrant
          { recordId: record.message.recordId }, // RecordsWrite
          { protocol: protocol.message.descriptor.definition.protocol } // ProtocolConfigure
        ],
      });
      const recordEventsReply = await dwn.processMessage(alice.did, eventsQueryRecords.message);
      expect(recordEventsReply.status.code).to.equal(200);
      expect(recordEventsReply.entries?.length).to.equal(3);
      expect(recordEventsReply.entries).to.have.members([
        await Message.getCid(record.message),
        await Message.getCid(grant.message),
        await Message.getCid(protocol.message),
      ]);
    });

    it('filters by interface type', async () => {
      // scenario:
      // alice creates 3 different types of messages (RecordsWrite, PermissionsGrant, ProtocolsConfigure)
      // alice queries for messages from each interface respectively (Records, Permissions, Protocols)
      // alice creates 2 additional messages (RecordsDelete, ProtocolsRevoke)
      // alice queries for messages for each interface respectively providing a cursor.

      const alice = await DidKeyResolver.generate();
      const record = await TestDataGenerator.generateRecordsWrite({ author: alice });
      const grant = await TestDataGenerator.generatePermissionsGrant({ author: alice });
      const protocol = await TestDataGenerator.generateProtocolsConfigure({ author: alice });

      // insert data
      const recordReply = await dwn.processMessage(alice.did, record.message, { dataStream: record.dataStream });
      const grantReply = await dwn.processMessage(alice.did, grant.message);
      const protocolReply = await dwn.processMessage(alice.did, protocol.message);
      expect(recordReply.status.code).to.equal(202, 'RecordsWrite');
      expect(grantReply.status.code).to.equal(202, 'PermissionsGrant');
      expect(protocolReply.status.code).to.equal(202, 'ProtocolConfigure');

      let eventsQueryRecords = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ interface: DwnInterfaceName.Records }],
      });
      const recordEventsReply = await dwn.processMessage(alice.did, eventsQueryRecords.message);
      expect(recordEventsReply.status.code).to.equal(200);
      expect(recordEventsReply.entries?.length).to.equal(1);
      expect(recordEventsReply.entries![0]).to.equal(await Message.getCid(record.message!));

      let eventsQueryGrants = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ interface: DwnInterfaceName.Permissions }],
      });
      const grantEventsReply = await dwn.processMessage(alice.did, eventsQueryGrants.message);
      expect(grantEventsReply.status.code).to.equal(200);
      expect(grantEventsReply.entries?.length).to.equal(1);
      expect(grantEventsReply.entries![0]).to.equal(await Message.getCid(grant.message!));

      let eventsQueryProtocols = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ interface: DwnInterfaceName.Protocols }],
      });
      const protocolEventsReply = await dwn.processMessage(alice.did, eventsQueryProtocols.message);
      expect(protocolEventsReply.status.code).to.equal(200);
      expect(protocolEventsReply.entries?.length).to.equal(1);
      expect(protocolEventsReply.entries![0]).to.equal(await Message.getCid(protocol.message!));


      // insert additional data to query beyond a cursor
      const recordDelete = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: record.message.recordId });
      const revokeGrant = await TestDataGenerator.generatePermissionsRevoke({
        author: alice, permissionsGrantId: await Message.getCid(grant.message)
      });
      const recordDeleteReply = await dwn.processMessage(alice.did, recordDelete.message);
      const revokeGrantReply = await dwn.processMessage(alice.did, revokeGrant.message);
      expect(recordDeleteReply.status.code).to.equal(202, 'RecordsDelete');
      expect(revokeGrantReply.status.code).to.equal(202, 'PermissionsRevoke');

      // query after cursor
      eventsQueryRecords = await TestDataGenerator.generateEventsQuery({
        cursor  : recordEventsReply.entries![0], // the message returned from prior query
        author  : alice,
        filters : [{ interface: DwnInterfaceName.Records }],
      });
      const recordEventsReplyAfterCursor = await dwn.processMessage(alice.did, eventsQueryRecords.message);
      expect(recordEventsReplyAfterCursor.status.code).to.equal(200);
      expect(recordEventsReplyAfterCursor.entries?.length).to.equal(1);
      expect(recordEventsReplyAfterCursor.entries![0]).to.equal(await Message.getCid(recordDelete.message!));

      eventsQueryGrants = await TestDataGenerator.generateEventsQuery({
        cursor  : grantEventsReply.entries![0], // the message returned from prior query
        author  : alice,
        filters : [{ interface: DwnInterfaceName.Permissions }],
      });
      const grantEventsReplyAfterCursor = await dwn.processMessage(alice.did, eventsQueryGrants.message);
      expect(grantEventsReplyAfterCursor.status.code).to.equal(200);
      expect(grantEventsReplyAfterCursor.entries?.length).to.equal(1);
      expect(grantEventsReplyAfterCursor.entries![0]).to.equal(await Message.getCid(revokeGrant.message!));

      eventsQueryProtocols = await TestDataGenerator.generateEventsQuery({
        cursor  : protocolEventsReply.entries![0], // the message returned from prior query
        author  : alice,
        filters : [{ interface: DwnInterfaceName.Protocols }],
      });
      const protocolEventsReplyAfterCursor = await dwn.processMessage(alice.did, eventsQueryProtocols.message);
      expect(protocolEventsReplyAfterCursor.status.code).to.equal(200);
      expect(protocolEventsReplyAfterCursor.entries?.length).to.equal(0); // no new messages
    });

    it('filters by method type', async () => {
      // scenario:
      // alice creates a variety of Messages (RecordsWrite, RecordsDelete, ProtocolConfigure, PermissionsGrant)
      // alice queries for only RecordsWrite messages
      // alice creates more messages to query beyond a cursor

      const alice = await DidKeyResolver.generate();

      // write 1
      const record1 = await TestDataGenerator.generateRecordsWrite({ author: alice });
      const record1Reply = await dwn.processMessage(alice.did, record1.message, { dataStream: record1.dataStream });
      expect(record1Reply.status.code).to.equal(202, 'RecordsWrite');

      // other messages
      const grant = await TestDataGenerator.generatePermissionsGrant({ author: alice });
      const grantReply = await dwn.processMessage(alice.did, grant.message);
      expect(grantReply.status.code).to.equal(202, 'PermissionsGrant');
      const protocol = await TestDataGenerator.generateProtocolsConfigure({ author: alice });
      const protocolReply = await dwn.processMessage(alice.did, protocol.message);
      expect(protocolReply.status.code).to.equal(202, 'ProtocolConfigure');

      // write 2
      const record2 = await TestDataGenerator.generateRecordsWrite({ author: alice });
      const record2Reply = await dwn.processMessage(alice.did, record2.message, { dataStream: record2.dataStream });
      expect(record2Reply.status.code).to.equal(202, 'RecordsWrite');

      // delete write 1
      const delete1 = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: record1.message.recordId });
      const delete1Reply = await dwn.processMessage(alice.did, delete1.message);
      expect(delete1Reply.status.code).to.equal(202, 'RecordsDelete');


      let recordsWriteEvents = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ interface: DwnInterfaceName.Records, method: DwnMethodName.Write }]
      });

      const recordsWriteEventsReply = await dwn.processMessage(alice.did, recordsWriteEvents.message);
      expect(recordsWriteEventsReply.status.code).to.equal(200);
      expect(recordsWriteEventsReply.entries?.length).to.equal(2);
      expect(recordsWriteEventsReply.entries![0]).to.equal(await Message.getCid(record1.message));
      expect(recordsWriteEventsReply.entries![1]).to.equal(await Message.getCid(record2.message));

      // additional messages
      const record2Update = await TestDataGenerator.generateFromRecordsWrite({ author: alice, existingWrite: record2.recordsWrite });
      const revokeGrant = await TestDataGenerator.generatePermissionsRevoke({
        author: alice, permissionsGrantId: await Message.getCid(grant.message)
      });
      const record2UpdateReply = await dwn.processMessage(alice.did, record2Update.message, { dataStream: record2Update.dataStream });
      const revokeGrantReply = await dwn.processMessage(alice.did, revokeGrant.message);
      expect(record2UpdateReply.status.code).to.equal(202, 'RecordsDelete');
      expect(revokeGrantReply.status.code).to.equal(202, 'PermissionsRevoke');

      recordsWriteEvents = await TestDataGenerator.generateEventsQuery({
        cursor  : recordsWriteEventsReply.entries![1],
        author  : alice,
        filters : [{ interface: DwnInterfaceName.Records, method: DwnMethodName.Write }]
      });

      const recordsWriteEventsReplyAfterCursor = await dwn.processMessage(alice.did, recordsWriteEvents.message);
      expect(recordsWriteEventsReplyAfterCursor.status.code).to.equal(200);
      expect(recordsWriteEventsReplyAfterCursor.entries?.length).to.equal(1);
      expect(recordsWriteEventsReplyAfterCursor.entries![0]).to.equal(await Message.getCid(record2Update.message));
    });

    it('filters by a dateUpdated (messageTimestamp) range across different message types', async () => {
      // scenario:
      // alice creates (3) messages, (RecordsWrite, PermissionsGrant and ProtocolsConfigure
      // each message on the first date of the year (2021, 2022 and 2023 respectively.
      // alice queries for all records beyond the last day of 2021 and should return 2 of the 3 messages (Grant and ProtocolConfigure)
      // alice then creates a RecordsDelete message for the original RecordsWrite
      // alice queries once again however supplying a cursor of the last message from the prior query, returning the RecordsDelete message.
      const firstDayOf2021 = Time.createTimestamp({ year: 2021, month: 1, day: 1 });
      const firstDayOf2022 = Time.createTimestamp({ year: 2022, month: 1, day: 1 });
      const firstDayOf2023 = Time.createTimestamp({ year: 2023, month: 1, day: 1 });

      const alice = await DidKeyResolver.generate();
      const write = await TestDataGenerator.generateRecordsWrite({ author: alice, dateCreated: firstDayOf2021, messageTimestamp: firstDayOf2021 });
      const grant = await TestDataGenerator.generatePermissionsGrant({ author: alice, messageTimestamp: firstDayOf2022 });
      const protocol = await TestDataGenerator.generateProtocolsConfigure({ author: alice, messageTimestamp: firstDayOf2023 });

      // insert data
      const writeReply = await dwn.processMessage(alice.did, write.message, { dataStream: write.dataStream });
      const grantReply = await dwn.processMessage(alice.did, grant.message);
      const protocolReply = await dwn.processMessage(alice.did, protocol.message);
      expect(writeReply.status.code).to.equal(202, 'RecordsWrite');
      expect(grantReply.status.code).to.equal(202, 'PermissionsGrant');
      expect(protocolReply.status.code).to.equal(202, 'ProtocolConfigure');

      // query from last day of 2021
      const lastDayOf2021 = Time.createTimestamp({ year: 2021, month: 12, day: 31 });
      let eventsQuery1 = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ dateUpdated: { from: lastDayOf2021 } }],
      });
      let reply1 = await dwn.processMessage(alice.did, eventsQuery1.message);
      expect(reply1.status.code).to.equal(200);
      expect(reply1.entries?.length).to.equal(2);
      expect(reply1.entries![0]).to.equal(await Message.getCid(grant.message!));
      expect(reply1.entries![1]).to.equal(await Message.getCid(protocol.message!));


      // delete the RecordsWrite
      const delete1 = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: write.message.recordId });
      const delete1Reply = await dwn.processMessage(alice.did, delete1.message);
      expect(delete1Reply.status.code).to.equal(202);

      eventsQuery1 = await TestDataGenerator.generateEventsQuery({
        cursor  : reply1.entries![1], // use the last messageCid from the prior query as a cursor
        author  : alice,
        filters : [{ dateUpdated: { from: lastDayOf2021 } }],
      });
      reply1 = await dwn.processMessage(alice.did, eventsQuery1.message);
      expect(reply1.status.code).to.equal(200);
      expect(reply1.entries?.length).to.equal(1);
      expect(reply1.entries![0]).to.equal(await Message.getCid(delete1.message!));
    });

    it('filters by dateCreated', async () => {
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
      const writeReply1 = await dwn.processMessage(alice.did, write1.message, { dataStream: write1.dataStream });
      const writeReply2 = await dwn.processMessage(alice.did, write2.message, { dataStream: write2.dataStream });
      const writeReply3 = await dwn.processMessage(alice.did, write3.message, { dataStream: write3.dataStream });
      const writeReply4 = await dwn.processMessage(alice.did, write4.message, { dataStream: write4.dataStream });
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
      expect(reply1.entries?.length).to.equal(3);
      expect(reply1.entries![0]).to.equal(await Message.getCid(write2.message!));
      expect(reply1.entries![1]).to.equal(await Message.getCid(write3.message!));
      expect(reply1.entries![2]).to.equal(await Message.getCid(write4.message!));

      // using the cursor of the first message
      eventsQuery1 = await TestDataGenerator.generateEventsQuery({
        cursor  : reply1.entries![0],
        author  : alice,
        filters : [{ dateCreated: { from: lastDayOf2021 } }],
      });
      reply1 = await dwn.processMessage(alice.did, eventsQuery1.message);
      expect(reply1.status.code).to.equal(200);
      expect(reply1.entries?.length).to.equal(2);
      expect(reply1.entries![0]).to.equal(await Message.getCid(write3.message!));
      expect(reply1.entries![1]).to.equal(await Message.getCid(write4.message!));

      // testing `to` range
      const lastDayOf2022 = Time.createTimestamp({ year: 2022, month: 12, day: 31 });
      let eventsQuery2 = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ dateCreated: { to: lastDayOf2022 } }],
      });
      let reply2 = await dwn.processMessage(alice.did, eventsQuery2.message);
      expect(reply2.status.code).to.equal(200);
      expect(reply2.entries?.length).to.equal(2);
      expect(reply2.entries![0]).to.equal(await Message.getCid(write1.message!));
      expect(reply2.entries![1]).to.equal(await Message.getCid(write2.message!));

      // using the cursor of the first message
      eventsQuery2 = await TestDataGenerator.generateEventsQuery({
        cursor  : reply2.entries![0],
        author  : alice,
        filters : [{ dateCreated: { to: lastDayOf2022 } }],
      });
      reply2 = await dwn.processMessage(alice.did, eventsQuery2.message);
      expect(reply2.status.code).to.equal(200);
      expect(reply2.entries?.length).to.equal(1);
      expect(reply2.entries![0]).to.equal(await Message.getCid(write2.message!));

      // testing `from` and `to` range
      const lastDayOf2023 = Time.createTimestamp({ year: 2023, month: 12, day: 31 });
      let eventsQuery3 = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ dateCreated: { from: lastDayOf2022, to: lastDayOf2023 } }],
      });
      let reply3 = await dwn.processMessage(alice.did, eventsQuery3.message);
      expect(reply3.status.code).to.equal(200);
      expect(reply3.entries?.length).to.equal(1);
      expect(reply3.entries![0]).to.equal(await Message.getCid(write3.message!));

      // using the cursor of the only message, should not return any results
      eventsQuery3 = await TestDataGenerator.generateEventsQuery({
        cursor  : reply3.entries![0],
        author  : alice,
        filters : [{ dateCreated: { from: lastDayOf2022, to: lastDayOf2023 } }],
      });
      reply3 = await dwn.processMessage(alice.did, eventsQuery3.message);
      expect(reply3.status.code).to.equal(200);
      expect(reply3.entries?.length).to.equal(0);

      // testing edge case where value equals `from` and `to`
      let eventsQuery4 = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ dateCreated: { from: firstDayOf2022, to: firstDayOf2023 } }],
      });
      let reply4 = await dwn.processMessage(alice.did, eventsQuery4.message);
      expect(reply4.status.code).to.equal(200);
      expect(reply4.entries?.length).to.equal(1);
      expect(reply4.entries![0]).to.equal(await Message.getCid(write2.message!));

      // testing edge case where value equals `from` and `to`
      eventsQuery4 = await TestDataGenerator.generateEventsQuery({
        cursor  : reply4.entries![0],
        author  : alice,
        filters : [{ dateCreated: { from: firstDayOf2022, to: firstDayOf2023 } }],
      });
      reply4 = await dwn.processMessage(alice.did, eventsQuery4.message);
      expect(reply4.status.code).to.equal(200);
      expect(reply4.entries?.length).to.equal(0);
    });

    it('filters by a protocol across different message types', async () => {
      // scenario:
      //    alice creates (3) different message types all related to "proto1" (Configure, RecordsWrite, RecordsDelete)
      //    alice creates (3) different message types all related to "proto2" (Configure, RecordsWrite, RecordsDelete)
      //    when issuing an EventsQuery for the specific protocol, only Events related to it should be returned.
      //    alice then creates an additional messages to query after a cursor

      const alice = await DidKeyResolver.generate();

      // create a proto1
      const protoConf1 = await TestDataGenerator.generateProtocolsConfigure({
        author             : alice,
        protocolDefinition : { ...freeForAll, protocol: 'proto1' }
      });

      const postProperties = {
        protocolPath : 'post',
        schema       : freeForAll.types.post.schema,
        dataFormat   : freeForAll.types.post.dataFormats[0],
      };

      const proto1 = protoConf1.message.descriptor.definition.protocol;
      const protoConf1Response = await dwn.processMessage(alice.did, protoConf1.message);
      expect(protoConf1Response.status.code).equals(202);

      // create a proto2
      const protoConf2 = await TestDataGenerator.generateProtocolsConfigure({
        author             : alice,
        protocolDefinition : { ...freeForAll, protocol: 'proto2' }
      });
      const proto2 = protoConf2.message.descriptor.definition.protocol;
      const protoConf2Response = await dwn.processMessage(alice.did, protoConf2.message);
      expect(protoConf2Response.status.code).equals(202);

      // create a record for proto1
      const write1proto1 = await TestDataGenerator.generateRecordsWrite({ author: alice, protocol: proto1, ...postProperties });
      const write1Response = await dwn.processMessage(alice.did, write1proto1.message, { dataStream: write1proto1.dataStream });
      expect(write1Response.status.code).equals(202);

      // create a record for proto2
      const write1proto2 = await TestDataGenerator.generateRecordsWrite({ author: alice, protocol: proto2, ...postProperties });
      const write1Proto2Response = await dwn.processMessage(alice.did, write1proto2.message, { dataStream: write1proto2.dataStream });
      expect(write1Proto2Response.status.code).equals(202);

      // filter for proto1
      let proto1EventsQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ protocol: proto1 }]
      });
      let proto1EventsReply = await dwn.processMessage(alice.did, proto1EventsQuery.message);
      expect(proto1EventsReply.status.code).equals(200);
      expect(proto1EventsReply.entries?.length).equals(2);

      // check order of events returned.
      expect(proto1EventsReply.entries![0]).to.equal(await Message.getCid(protoConf1.message));
      expect(proto1EventsReply.entries![1]).to.equal(await Message.getCid(write1proto1.message));

      // filter for proto2
      let proto2EventsQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ protocol: proto2 }]
      });
      let proto2EventsReply = await dwn.processMessage(alice.did, proto2EventsQuery.message);
      expect(proto2EventsReply.status.code).equals(200);
      expect(proto2EventsReply.entries?.length).equals(2);

      // check order of events returned.
      expect(proto2EventsReply.entries![0]).to.equal(await Message.getCid(protoConf2.message));
      expect(proto2EventsReply.entries![1]).to.equal(await Message.getCid(write1proto2.message));

      // get cursor of the last event and add more events to query afterwards
      const proto1Cursor = proto1EventsReply.entries![1];
      const proto2Cursor = proto2EventsReply.entries![1];

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
      expect(proto1EventsReply.entries?.length).equals(1);
      expect(proto1EventsReply.entries![0]).to.equal(await Message.getCid(deleteProto1Message.message));

      //query messages beyond the cursor
      proto2EventsQuery = await TestDataGenerator.generateEventsQuery({
        cursor  : proto2Cursor,
        author  : alice,
        filters : [{ protocol: proto2 }],
      });
      proto2EventsReply = await dwn.processMessage(alice.did, proto2EventsQuery.message);
      expect(proto2EventsReply.status.code).equals(200);
      expect(proto2EventsReply.entries?.length).equals(1);
      expect(proto2EventsReply.entries![0]).to.equal(await Message.getCid(deleteProto2Message.message));
    });

    it('filters by protocol, protocolPath & parentId', async () => {
      // scenario: get all messages across a protocol & protocolPath combo
      //    alice installs a protocol and creates a thread
      //    alice adds bob and carol as participants
      //    alice, bob, and carol all create messages
      //    alice filter for 'thread', 'thread/participants' and 'thread/messages'
      //    alice deletes carol participant message
      //    alice filters for 'thread/participant' after a cursor

      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();
      const carol = await DidKeyResolver.generate();

      // create protocol
      const protocolConfigure = await TestDataGenerator.generateProtocolsConfigure({
        author             : alice,
        protocolDefinition : { ...threadProtocol }
      });
      const protocolConfigureReply = await dwn.processMessage(alice.did, protocolConfigure.message);
      expect(protocolConfigureReply.status.code).to.equal(202);
      const protocol = protocolConfigure.message.descriptor.definition.protocol;

      // alice creates thread
      const thread = await TestDataGenerator.generateRecordsWrite({
        author       : alice,
        protocol     : protocol,
        protocolPath : 'thread'
      });
      const threadReply = await dwn.processMessage(alice.did, thread.message, { dataStream: thread.dataStream });
      expect(threadReply.status.code).to.equal(202);

      // add bob as participant
      const bobParticipant = await TestDataGenerator.generateRecordsWrite({
        author       : alice,
        recipient    : bob.did,
        parentId     : thread.message.recordId,
        contextId    : thread.message.contextId,
        protocol     : protocol,
        protocolPath : 'thread/participant'
      });
      const bobParticipantReply = await dwn.processMessage(alice.did, bobParticipant.message, { dataStream: bobParticipant.dataStream });
      expect(bobParticipantReply.status.code).to.equal(202);

      // add carol as participant
      const carolParticipant = await TestDataGenerator.generateRecordsWrite({
        author       : alice,
        recipient    : carol.did,
        parentId     : thread.message.recordId,
        contextId    : thread.message.contextId,
        protocol     : protocol,
        protocolPath : 'thread/participant'
      });
      const carolParticipantReply = await dwn.processMessage(alice.did, carolParticipant.message, { dataStream: carolParticipant.dataStream });
      expect(carolParticipantReply.status.code).to.equal(202);

      // add a message to protocol1
      const message1 = await TestDataGenerator.generateRecordsWrite({
        author       : bob,
        recipient    : alice.did,
        parentId     : thread.message.recordId,
        contextId    : thread.message.contextId,
        protocol     : protocol,
        protocolPath : 'thread/chat',
        protocolRole : 'thread/participant',
      });
      const message1Reply = await dwn.processMessage(alice.did, message1.message, { dataStream: message1.dataStream });
      expect(message1Reply.status.code).to.equal(202);

      const message2 = await TestDataGenerator.generateRecordsWrite({
        author       : bob,
        recipient    : alice.did,
        parentId     : thread.message.recordId,
        contextId    : thread.message.contextId,
        protocol     : protocol,
        protocolPath : 'thread/chat',
        protocolRole : 'thread/participant',
      });
      const message2Reply = await dwn.processMessage(alice.did, message2.message, { dataStream: message2.dataStream });
      expect(message2Reply.status.code).to.equal(202);

      const message3 = await TestDataGenerator.generateRecordsWrite({
        author       : carol,
        recipient    : alice.did,
        parentId     : thread.message.recordId,
        contextId    : thread.message.contextId,
        protocol     : protocol,
        protocolPath : 'thread/chat',
        protocolRole : 'thread/participant',
      });
      const message3Reply = await dwn.processMessage(alice.did, message3.message, { dataStream: message3.dataStream });
      expect(message3Reply.status.code).to.equal(202);

      // query for thread
      const threadQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ protocol: protocol, protocolPath: 'thread' }],
      });
      const threadQueryReply = await dwn.processMessage(alice.did, threadQuery.message);
      expect(threadQueryReply.status.code).to.equal(200);
      expect(threadQueryReply.entries?.length).to.equal(1);
      expect(threadQueryReply.entries![0]).to.equal(await Message.getCid(thread.message));

      // query for participants
      const participantsQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ protocol: protocol, protocolPath: 'thread/participant', parentId: thread.message.recordId }],
      });
      const participantsQueryReply = await dwn.processMessage(alice.did, participantsQuery.message);
      expect(participantsQueryReply.status.code).to.equal(200);
      expect(participantsQueryReply.entries?.length).to.equal(2);
      expect(participantsQueryReply.entries![0]).to.equal(await Message.getCid(bobParticipant.message));
      expect(participantsQueryReply.entries![1]).to.equal(await Message.getCid(carolParticipant.message));

      // query for chats
      const chatQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ protocol: protocol, protocolPath: 'thread/chat', parentId: thread.message.recordId }],
      });
      const chatQueryReply = await dwn.processMessage(alice.did, chatQuery.message);
      expect(chatQueryReply.status.code).to.equal(200);
      expect(chatQueryReply.entries?.length).to.equal(3);
      expect(chatQueryReply.entries![0]).to.equal(await Message.getCid(message1.message));
      expect(chatQueryReply.entries![1]).to.equal(await Message.getCid(message2.message));
      expect(chatQueryReply.entries![2]).to.equal(await Message.getCid(message3.message));
    });

    it('filters by recipient', async () => {
      // scenario: alice installs a free-for-all protocol and makes posts with both bob and carol as recipients
      // carol and bob also make posts with alice as a recipient
      // alice queries for events meant for specific recipients
      // alice then makes another message to query for using the pervious as a cursor

      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();
      const carol = await DidKeyResolver.generate();

      const protocolConfigure = await TestDataGenerator.generateProtocolsConfigure({
        author             : alice,
        protocolDefinition : { ...freeForAll }
      });
      const protocolConfigureReply = await dwn.processMessage(alice.did, protocolConfigure.message);
      expect(protocolConfigureReply.status.code).to.equal(202);
      const protocol = protocolConfigure.message.descriptor.definition.protocol;

      const postProperties = {
        protocol     : protocol,
        protocolPath : 'post',
        schema       : freeForAll.types.post.schema,
        dataFormat   : freeForAll.types.post.dataFormats[0],
      };

      const messageFromAliceToBob = await TestDataGenerator.generateRecordsWrite({
        ...postProperties,
        author    : alice,
        recipient : bob.did,
      });
      const messageFromAliceToBobReply =
        await dwn.processMessage(alice.did, messageFromAliceToBob.message, { dataStream: messageFromAliceToBob.dataStream });
      expect(messageFromAliceToBobReply.status.code).to.equal(202);

      const messageFromAliceToCarol = await TestDataGenerator.generateRecordsWrite({
        ...postProperties,
        author    : alice,
        recipient : carol.did,
      });
      const messageFromAliceToCarolReply =
        await dwn.processMessage(alice.did, messageFromAliceToCarol.message, { dataStream: messageFromAliceToCarol.dataStream });
      expect(messageFromAliceToCarolReply.status.code).to.equal(202);

      const messageFromBobToAlice = await TestDataGenerator.generateRecordsWrite({
        ...postProperties,
        author    : bob,
        recipient : alice.did,
      });
      const messageFromBobToAliceReply =
        await dwn.processMessage(alice.did, messageFromBobToAlice.message, { dataStream: messageFromBobToAlice.dataStream });
      expect(messageFromBobToAliceReply.status.code).to.equal(202);

      const messageFromCarolToAlice = await TestDataGenerator.generateRecordsWrite({
        ...postProperties,
        author    : carol,
        recipient : alice.did,
      });
      const messageFromCarolToAliceReply =
        await dwn.processMessage(alice.did, messageFromCarolToAlice.message, { dataStream: messageFromCarolToAlice.dataStream });
      expect(messageFromCarolToAliceReply.status.code).to.equal(202);

      let authorQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ recipient: alice.did }]
      });
      let authorQueryReply = await dwn.processMessage(alice.did, authorQuery.message);
      expect(authorQueryReply.status.code).to.equal(200);
      expect(authorQueryReply.entries?.length).to.equal(2);
      expect(authorQueryReply.entries![0]).to.equal(await Message.getCid(messageFromBobToAlice.message));
      expect(authorQueryReply.entries![1]).to.equal(await Message.getCid(messageFromCarolToAlice.message));

      authorQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ recipient: bob.did }]
      });
      authorQueryReply = await dwn.processMessage(alice.did, authorQuery.message);
      expect(authorQueryReply.status.code).to.equal(200);
      expect(authorQueryReply.entries?.length).to.equal(1);
      expect(authorQueryReply.entries![0]).to.equal(await Message.getCid(messageFromAliceToBob.message));


      // add another message
      const messageFromAliceToBob2 = await TestDataGenerator.generateRecordsWrite({
        ...postProperties,
        author    : alice,
        recipient : bob.did,
      });
      const messageFromAliceToBob2Reply =
        await dwn.processMessage(alice.did, messageFromAliceToBob2.message, { dataStream: messageFromAliceToBob2.dataStream });
      expect(messageFromAliceToBob2Reply.status.code).to.equal(202);

      authorQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ recipient: bob.did }],
        cursor  : authorQueryReply.entries![0]
      });

      authorQueryReply = await dwn.processMessage(alice.did, authorQuery.message);
      expect(authorQueryReply.status.code).to.equal(200);
      expect(authorQueryReply.entries?.length).to.equal(1);
      expect(authorQueryReply.entries![0]).to.equal(await Message.getCid(messageFromAliceToBob2.message));
    });

    it('filters by schema', async () => {
      const alice = await DidKeyResolver.generate();

      const schema1Message1 = await TestDataGenerator.generateRecordsWrite({
        author : alice,
        schema : 'schema1'
      });
      const schema1Message1Reply = await dwn.processMessage(alice.did, schema1Message1.message, { dataStream: schema1Message1.dataStream });
      expect(schema1Message1Reply.status.code).to.equal(202);

      const schema2Message1 = await TestDataGenerator.generateRecordsWrite({
        author : alice,
        schema : 'schema2'
      });
      const schema2Message1Reply = await dwn.processMessage(alice.did, schema2Message1.message, { dataStream: schema2Message1.dataStream });
      expect(schema2Message1Reply.status.code).to.equal(202);

      const schema2Message2 = await TestDataGenerator.generateRecordsWrite({
        author : alice,
        schema : 'schema2'
      });
      const schema2Message2Reply = await dwn.processMessage(alice.did, schema2Message2.message, { dataStream: schema2Message2.dataStream });
      expect(schema2Message2Reply.status.code).to.equal(202);

      let schema1Query = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ schema: 'schema1' }],
      });
      let schema1QueryReply = await dwn.processMessage(alice.did, schema1Query.message);
      expect(schema1QueryReply.status.code).to.equal(200);
      expect(schema1QueryReply.entries?.length).to.equal(1);
      expect(schema1QueryReply.entries![0]).to.equal(await Message.getCid(schema1Message1.message));

      let schema2Query = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ schema: 'schema2' }],
      });
      let schema2QueryReply = await dwn.processMessage(alice.did, schema2Query.message);
      expect(schema2QueryReply.status.code).to.equal(200);
      expect(schema2QueryReply.entries?.length).to.equal(2);
      expect(schema2QueryReply.entries![0]).to.equal(await Message.getCid(schema2Message1.message));
      expect(schema2QueryReply.entries![1]).to.equal(await Message.getCid(schema2Message2.message));

      const schema1Message2 = await TestDataGenerator.generateRecordsWrite({
        author : alice,
        schema : 'schema1'
      });
      const schema1Message2Reply = await dwn.processMessage(alice.did, schema1Message2.message, { dataStream: schema1Message2.dataStream });
      expect(schema1Message2Reply.status.code).to.equal(202);

      schema1Query = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ schema: 'schema1' }],
        cursor  : schema1QueryReply.entries![0]
      });
      schema1QueryReply = await dwn.processMessage(alice.did, schema1Query.message);
      expect(schema1QueryReply.status.code).to.equal(200);
      expect(schema1QueryReply.entries?.length).to.equal(1);
      expect(schema1QueryReply.entries![0]).to.equal(await Message.getCid(schema1Message2.message));

      schema2Query = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ schema: 'schema2' }],
        cursor  : schema2QueryReply.entries![1]
      });
      schema2QueryReply = await dwn.processMessage(alice.did, schema2Query.message);
      expect(schema2QueryReply.status.code).to.equal(200);
      expect(schema2QueryReply.entries?.length).to.equal(0);
    });

    xit('filters by recordId', async () => {
      const alice = await DidKeyResolver.generate();

      // a write as a control, will not show up in query
      const controlWrite = await TestDataGenerator.generateRecordsWrite({
        author : alice,
        schema : 'schema1'
      });
      const write2Reply = await dwn.processMessage(alice.did, controlWrite.message, { dataStream: controlWrite.dataStream });
      expect(write2Reply.status.code).to.equal(202);

      const write = await TestDataGenerator.generateRecordsWrite({
        author : alice,
        schema : 'schema1'
      });
      const write1Reply = await dwn.processMessage(alice.did, write.message, { dataStream: write.dataStream });
      expect(write1Reply.status.code).to.equal(202);

      const update = await TestDataGenerator.generateFromRecordsWrite({
        author        : alice,
        existingWrite : write.recordsWrite,
      });
      const updateReply = await dwn.processMessage(alice.did, update.message, { dataStream: update.dataStream });
      expect(updateReply.status.code).to.equal(202);

      let recordQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ recordId: write.message.recordId }],
      });
      let recordQueryReply = await dwn.processMessage(alice.did, recordQuery.message);
      expect(recordQueryReply.status.code).to.equal(200);
      expect(recordQueryReply.entries?.length).to.equal(2);
      expect(recordQueryReply.entries![0]).to.equal(await Message.getCid(write.message));
      expect(recordQueryReply.entries![1]).to.equal(await Message.getCid(update.message));

      const deleteRecord = await TestDataGenerator.generateRecordsDelete({
        author   : alice,
        recordId : write.message.recordId,
      });
      const deleteRecordReply = await dwn.processMessage(alice.did, deleteRecord.message);
      expect(deleteRecordReply.status.code).to.equal(202);

      recordQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ recordId: write.message.recordId }],
        cursor  : recordQueryReply.entries![1]
      });
      recordQueryReply = await dwn.processMessage(alice.did, recordQuery.message);
      expect(recordQueryReply.status.code).to.equal(200);
      expect(recordQueryReply.entries?.length).to.equal(1);
      expect(recordQueryReply.entries![0]).to.equal(await Message.getCid(deleteRecord.message));
    });

    it('filters by dataFormat', async () => {
      // scenario: alice stores different file types and needs events relating to `image/jpeg`
      //  alice creates 3 files, one of them `image/jpeg`
      //  alice queries for `image/jpeg` retrieving the one message
      //  alice adds another image to query for using the prior image as a cursor

      const alice = await DidKeyResolver.generate();

      const textFile = await TestDataGenerator.generateRecordsWrite({
        author     : alice,
        dataFormat : 'application/text'
      });
      const textFileReply = await dwn.processMessage(alice.did, textFile.message, { dataStream: textFile.dataStream });
      expect(textFileReply.status.code).to.equal(202);

      const jsonData = await TestDataGenerator.generateRecordsWrite({
        author     : alice,
        dataFormat : 'application/json'
      });
      const jsonDataReply = await dwn.processMessage(alice.did, jsonData.message, { dataStream: jsonData.dataStream });
      expect(jsonDataReply.status.code).to.equal(202);

      const imageData = await TestDataGenerator.generateRecordsWrite({
        author     : alice,
        dataFormat : 'image/jpeg'
      });
      const imageDataReply = await dwn.processMessage(alice.did, imageData.message, { dataStream: imageData.dataStream });
      expect(imageDataReply.status.code).to.equal(202);

      //get image data
      let imageQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{
          dataFormat: 'image/jpeg'
        }]
      });
      let imageQueryReply = await dwn.processMessage(alice.did, imageQuery.message);
      expect(imageQueryReply.status.code).to.equal(200);
      expect(imageQueryReply.entries?.length).to.equal(1);
      expect(imageQueryReply.entries![0]).to.equal(await Message.getCid(imageData.message));

      // add another image
      const imageData2 = await TestDataGenerator.generateRecordsWrite({
        author     : alice,
        dataFormat : 'image/jpeg'
      });
      const imageData2Reply = await dwn.processMessage(alice.did, imageData2.message, { dataStream: imageData2.dataStream });
      expect(imageData2Reply.status.code).to.equal(202);

      imageQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{
          dataFormat: 'image/jpeg'
        }],
        cursor: imageQueryReply.entries![0]
      });
      imageQueryReply = await dwn.processMessage(alice.did, imageQuery.message);
      expect(imageQueryReply.status.code).to.equal(200);
      expect(imageQueryReply.entries?.length).to.equal(1);
      expect(imageQueryReply.entries![0]).to.equal(await Message.getCid(imageData2.message));
    });;

    it('filters by dataSize', async () => {
      // scenario:
      //    alice inserts both small and large data
      //    alice requests events for messages with data size under a threshold

      const alice = await DidKeyResolver.generate();

      const smallSize1 = await TestDataGenerator.generateRecordsWrite({
        author: alice,
      });
      const smallSize1Reply = await dwn.processMessage(alice.did, smallSize1.message, { dataStream: smallSize1.dataStream });
      expect(smallSize1Reply.status.code).to.equal(202);

      const largeSize = await TestDataGenerator.generateRecordsWrite({
        author : alice,
        data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 1)
      });
      const largeSizeReply = await dwn.processMessage(alice.did, largeSize.message, { dataStream: largeSize.dataStream });
      expect(largeSizeReply.status.code).to.equal(202);

      const smallSize2 = await TestDataGenerator.generateRecordsWrite({
        author: alice,
      });
      const smallSize2Reply = await dwn.processMessage(alice.did, smallSize2.message, { dataStream: smallSize2.dataStream });
      expect(smallSize2Reply.status.code).to.equal(202);

      //get large sizes
      let largeSizeQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{
          dataSize: { gte: DwnConstant.maxDataSizeAllowedToBeEncoded + 1 }
        }]
      });
      let largeSizeQueryReply = await dwn.processMessage(alice.did, largeSizeQuery.message);
      expect(largeSizeQueryReply.status.code).to.equal(200);
      expect(largeSizeQueryReply.entries?.length).to.equal(1);
      expect(largeSizeQueryReply.entries![0]).to.equal(await Message.getCid(largeSize.message));

      const largeSize2 = await TestDataGenerator.generateRecordsWrite({
        author : alice,
        data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 1)
      });
      const largeSize2Reply = await dwn.processMessage(alice.did, largeSize2.message, { dataStream: largeSize2.dataStream });
      expect(largeSize2Reply.status.code).to.equal(202);

      largeSizeQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{
          dataSize: { gte: DwnConstant.maxDataSizeAllowedToBeEncoded + 1 }
        }],
        cursor: largeSizeQueryReply.entries![0]
      });
      largeSizeQueryReply = await dwn.processMessage(alice.did, largeSizeQuery.message);
      expect(largeSizeQueryReply.status.code).to.equal(200);
      expect(largeSizeQueryReply.entries?.length).to.equal(1);
      expect(largeSizeQueryReply.entries![0]).to.equal(await Message.getCid(largeSize2.message));
    });

    it('filters by contextId', async () => {
      // scenario:
      //    alice configures a chat protocols and creates 2 chat threads
      //    alice invites bob as participant in thread1 and carol in thread2
      //    alice writes messages to both bob and carol in their respective threads
      //    alice queries for events related to thread1 (gets the configure, bob participant, and chats to bob)
      //    alice writes more messages to both bob and carol in their respective threads
      //    alice queries for events beyond the latest from the last query, retrieving the additional messages to bob

      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();
      const carol = await DidKeyResolver.generate();

      const protocolConfigure = await TestDataGenerator.generateProtocolsConfigure({
        author             : alice,
        protocolDefinition : { ...threadProtocol }
      });
      const protocolConfigureReply = await dwn.processMessage(alice.did, protocolConfigure.message);
      expect(protocolConfigureReply.status.code).to.equal(202);
      const protocol = protocolConfigure.message.descriptor.definition.protocol;

      // alice creates 2 threads
      const thread1 = await TestDataGenerator.generateRecordsWrite({
        author       : alice,
        protocol     : protocol,
        protocolPath : 'thread',
      });
      const thread1Reply = await dwn.processMessage(alice.did, thread1.message, { dataStream: thread1.dataStream });
      expect(thread1Reply.status.code).to.equal(202);

      const thread2 = await TestDataGenerator.generateRecordsWrite({
        author       : alice,
        protocol     : protocol,
        protocolPath : 'thread',
      });
      const thread2Reply = await dwn.processMessage(alice.did, thread2.message, { dataStream: thread2.dataStream });
      expect(thread2Reply.status.code).to.equal(202);

      // alice adds bob as a participant to thread 1
      const bobParticipant = await TestDataGenerator.generateRecordsWrite({
        author       : alice,
        recipient    : bob.did,
        parentId     : thread1.message.recordId,
        contextId    : thread1.message.contextId,
        protocol     : protocol,
        protocolPath : 'thread/participant'
      });
      const bobParticipantReply = await dwn.processMessage(alice.did, bobParticipant.message, { dataStream: bobParticipant.dataStream });
      expect(bobParticipantReply.status.code).to.equal(202);

      // alice adds carol as a participant to thread 1
      const carolParticipant = await TestDataGenerator.generateRecordsWrite({
        author       : alice,
        recipient    : carol.did,
        parentId     : thread2.message.recordId,
        contextId    : thread2.message.contextId,
        protocol     : protocol,
        protocolPath : 'thread/participant'
      });
      const carolParticipantReply = await dwn.processMessage(alice.did, carolParticipant.message, { dataStream: carolParticipant.dataStream });
      expect(carolParticipantReply.status.code).to.equal(202);

      // alice writes a message to bob on thread 1
      const thread1Chat1 = await TestDataGenerator.generateRecordsWrite({
        author       : alice,
        recipient    : bob.did,
        parentId     : thread1.message.recordId,
        contextId    : thread1.message.contextId,
        protocol     : protocol,
        protocolPath : 'thread/chat',
      });
      const thread1Chat1Reply = await dwn.processMessage(alice.did, thread1Chat1.message, { dataStream: thread1Chat1.dataStream });
      expect(thread1Chat1Reply.status.code).to.equal(202);

      // alice writes a message to carol on thread 2
      const thread2Chat1 = await TestDataGenerator.generateRecordsWrite({
        author       : alice,
        recipient    : carol.did,
        parentId     : thread2.message.recordId,
        contextId    : thread2.message.contextId,
        protocol     : protocol,
        protocolPath : 'thread/chat',
      });
      const thread2Chat1Reply = await dwn.processMessage(alice.did, thread2Chat1.message, { dataStream: thread2Chat1.dataStream });
      expect(thread2Chat1Reply.status.code).to.equal(202);

      // alice writes another message to bob on thread 1
      const thread1Chat2 = await TestDataGenerator.generateRecordsWrite({
        author       : alice,
        recipient    : bob.did,
        parentId     : thread1.message.recordId,
        contextId    : thread1.message.contextId,
        protocol     : protocol,
        protocolPath : 'thread/chat',
      });
      const chatMessage2Reply = await dwn.processMessage(alice.did, thread1Chat2.message, { dataStream: thread1Chat2.dataStream });
      expect(chatMessage2Reply.status.code).to.equal(202);

      // alice queries events for thread1
      let threadContextQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{
          protocol  : protocol,
          contextId : thread1.message.contextId,
        }],
      });
      let threadContextQueryReply = await dwn.processMessage(alice.did, threadContextQuery.message);
      expect(threadContextQueryReply.status.code).to.equal(200);
      expect(threadContextQueryReply.entries?.length).to.equal(4);
      expect(threadContextQueryReply.entries![0]).to.equal(await Message.getCid(thread1.message));
      expect(threadContextQueryReply.entries![1]).to.equal(await Message.getCid(bobParticipant.message));
      expect(threadContextQueryReply.entries![2]).to.equal(await Message.getCid(thread1Chat1.message));
      expect(threadContextQueryReply.entries![3]).to.equal(await Message.getCid(thread1Chat2.message));

      // alice adds more chats to both threads
      const thread1Chat3 = await TestDataGenerator.generateRecordsWrite({
        author       : alice,
        recipient    : bob.did,
        parentId     : thread1.message.recordId,
        contextId    : thread1.message.contextId,
        protocol     : protocol,
        protocolPath : 'thread/chat',
      });
      const thread1Chat3Reply = await dwn.processMessage(alice.did, thread1Chat3.message, { dataStream: thread1Chat3.dataStream });
      expect(thread1Chat3Reply.status.code).to.equal(202);

      const thread2Chat2 = await TestDataGenerator.generateRecordsWrite({
        author       : alice,
        recipient    : carol.did,
        parentId     : thread2.message.recordId,
        contextId    : thread2.message.contextId,
        protocol     : protocol,
        protocolPath : 'thread/chat',
      });
      const thread2Chat2Reply = await dwn.processMessage(alice.did, thread2Chat2.message, { dataStream: thread2Chat2.dataStream });
      expect(thread2Chat2Reply.status.code).to.equal(202);

      // query beyond a cursor
      threadContextQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{
          protocol  : protocol,
          contextId : thread1.message.contextId,
        }],
        cursor: threadContextQueryReply.entries![3]
      });
      threadContextQueryReply = await dwn.processMessage(alice.did, threadContextQuery.message);
      expect(threadContextQueryReply.status.code).to.equal(200);
      expect(threadContextQueryReply.entries?.length).to.equal(1);
      expect(threadContextQueryReply.entries![0]).to.equal(await Message.getCid(thread1Chat3.message));
    });
  });
};