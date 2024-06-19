import type { DidResolver } from '@web5/dids';
import type {
  DataStore,
  EventLog,
  EventStream,
  MessageStore,
  ResumableTaskStore,
} from '../../src/index.js';

import freeForAll from '../vectors/protocol-definitions/free-for-all.json' assert { type: 'json' };

import { expect } from 'chai';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { DidKey, UniversalResolver } from '@web5/dids';
import { Dwn, DwnInterfaceName, DwnMethodName, Message, Time } from '../../src/index.js';

export function testEventsQueryScenarios(): void {
  describe('events query tests', () => {
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

    it('supports multiple filter types', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const record = await TestDataGenerator.generateRecordsWrite({ author: alice });
      const protocol = await TestDataGenerator.generateProtocolsConfigure({ author: alice });

      // insert data
      const recordReply = await dwn.processMessage(alice.did, record.message, { dataStream: record.dataStream });
      const protocolReply = await dwn.processMessage(alice.did, protocol.message);
      expect(recordReply.status.code).to.equal(202, 'RecordsWrite');
      expect(protocolReply.status.code).to.equal(202, 'ProtocolConfigure');

      const eventsQueryRecords = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [
          { interface: DwnInterfaceName.Records }, // returns the RecordsWrite
          { protocol: protocol.message.descriptor.definition.protocol } // returns the ProtocolConfigure
        ],
      });
      const recordEventsReply = await dwn.processMessage(alice.did, eventsQueryRecords.message);
      expect(recordEventsReply.status.code).to.equal(200);
      expect(recordEventsReply.entries?.length).to.equal(2);
      expect(recordEventsReply.entries).to.have.members([
        await Message.getCid(record.message),
        await Message.getCid(protocol.message),
      ]);
    });

    it('filters by interface type', async () => {
      // scenario:
      // alice creates 2 different types of messages (RecordsWrite, ProtocolsConfigure)
      // alice queries for messages from each interface respectively (Records, Protocols)
      // alice creates 2 additional messages (RecordsDelete, ProtocolsRevoke)
      // alice queries for messages for each interface respectively providing a cursor.

      const alice = await TestDataGenerator.generateDidKeyPersona();
      const record = await TestDataGenerator.generateRecordsWrite({ author: alice });
      const protocol = await TestDataGenerator.generateProtocolsConfigure({ author: alice });

      // insert data
      const recordReply = await dwn.processMessage(alice.did, record.message, { dataStream: record.dataStream });
      const protocolReply = await dwn.processMessage(alice.did, protocol.message);
      expect(recordReply.status.code).to.equal(202, 'RecordsWrite');
      expect(protocolReply.status.code).to.equal(202, 'ProtocolConfigure');

      let eventsQueryRecords = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ interface: DwnInterfaceName.Records }],
      });
      const recordEventsReply = await dwn.processMessage(alice.did, eventsQueryRecords.message);
      expect(recordEventsReply.status.code).to.equal(200);
      expect(recordEventsReply.entries?.length).to.equal(1);
      expect(recordEventsReply.entries![0]).to.equal(await Message.getCid(record.message!));

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
      const recordDeleteReply = await dwn.processMessage(alice.did, recordDelete.message);
      expect(recordDeleteReply.status.code).to.equal(202, 'RecordsDelete');

      // query after cursor
      eventsQueryRecords = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ interface: DwnInterfaceName.Records }],
        cursor  : recordEventsReply.cursor, // the cursor from the prior query
      });
      const recordEventsReplyAfterCursor = await dwn.processMessage(alice.did, eventsQueryRecords.message);
      expect(recordEventsReplyAfterCursor.status.code).to.equal(200);
      expect(recordEventsReplyAfterCursor.entries?.length).to.equal(1);
      expect(recordEventsReplyAfterCursor.entries![0]).to.equal(await Message.getCid(recordDelete.message!));

      eventsQueryProtocols = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ interface: DwnInterfaceName.Protocols }],
        cursor  : protocolEventsReply.cursor, // the cursor from the prior query
      });
      const protocolEventsReplyAfterCursor = await dwn.processMessage(alice.did, eventsQueryProtocols.message);
      expect(protocolEventsReplyAfterCursor.status.code).to.equal(200);
      expect(protocolEventsReplyAfterCursor.entries?.length).to.equal(0); // no new messages
    });

    it('filters by method type', async () => {
      // scenario:
      // alice creates a variety of Messages (RecordsWrite, RecordsDelete, ProtocolConfigure)
      // alice queries for only RecordsWrite messages
      // alice creates more messages to query beyond a cursor

      const alice = await TestDataGenerator.generateDidKeyPersona();

      // write 1
      const record1 = await TestDataGenerator.generateRecordsWrite({ author: alice });
      const record1Reply = await dwn.processMessage(alice.did, record1.message, { dataStream: record1.dataStream });
      expect(record1Reply.status.code).to.equal(202, 'RecordsWrite');

      // other messages
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
      const record2UpdateReply = await dwn.processMessage(alice.did, record2Update.message, { dataStream: record2Update.dataStream });
      expect(record2UpdateReply.status.code).to.equal(202, 'RecordsDelete');

      recordsWriteEvents = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ interface: DwnInterfaceName.Records, method: DwnMethodName.Write }],
        cursor  : recordsWriteEventsReply.cursor,
      });

      const recordsWriteEventsReplyAfterCursor = await dwn.processMessage(alice.did, recordsWriteEvents.message);
      expect(recordsWriteEventsReplyAfterCursor.status.code).to.equal(200);
      expect(recordsWriteEventsReplyAfterCursor.entries?.length).to.equal(1);
      expect(recordsWriteEventsReplyAfterCursor.entries![0]).to.equal(await Message.getCid(record2Update.message));
    });

    it('filters by a messageTimestamp range across different message types', async () => {
      // scenario:
      // alice creates (2) messages, (RecordsWrite and ProtocolsConfigure)
      // each message on the first date of the year (2021, 2022 respectively.
      // alice queries for all records beyond the last day of 2021 and should return 1 of the 2 messages (ProtocolConfigure)
      // alice then creates a RecordsDelete message for the original RecordsWrite
      // alice queries once again however supplying a cursor of the last message from the prior query, returning the RecordsDelete message.
      const firstDayOf2021 = Time.createTimestamp({ year: 2021, month: 1, day: 1 });
      const firstDayOf2022 = Time.createTimestamp({ year: 2022, month: 1, day: 1 });

      const alice = await TestDataGenerator.generateDidKeyPersona();
      const write = await TestDataGenerator.generateRecordsWrite({ author: alice, dateCreated: firstDayOf2021, messageTimestamp: firstDayOf2021 });
      const protocol = await TestDataGenerator.generateProtocolsConfigure({ author: alice, messageTimestamp: firstDayOf2022 });

      // insert data
      const writeReply = await dwn.processMessage(alice.did, write.message, { dataStream: write.dataStream });
      const protocolReply = await dwn.processMessage(alice.did, protocol.message);
      expect(writeReply.status.code).to.equal(202, 'RecordsWrite');
      expect(protocolReply.status.code).to.equal(202, 'ProtocolConfigure');

      // query from last day of 2021
      const lastDayOf2021 = Time.createTimestamp({ year: 2021, month: 12, day: 31 });
      let eventsQuery1 = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ messageTimestamp: { from: lastDayOf2021 } }],
      });
      let reply1 = await dwn.processMessage(alice.did, eventsQuery1.message);
      expect(reply1.status.code).to.equal(200);
      expect(reply1.entries?.length).to.equal(1);
      expect(reply1.entries![0]).to.equal(await Message.getCid(protocol.message!));

      // delete the RecordsWrite
      const delete1 = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: write.message.recordId });
      const delete1Reply = await dwn.processMessage(alice.did, delete1.message);
      expect(delete1Reply.status.code).to.equal(202);

      eventsQuery1 = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ messageTimestamp: { from: lastDayOf2021 } }],
        cursor  : reply1.cursor
      });
      reply1 = await dwn.processMessage(alice.did, eventsQuery1.message);
      expect(reply1.status.code).to.equal(200);
      expect(reply1.entries?.length).to.equal(1);
      expect(reply1.entries![0]).to.equal(await Message.getCid(delete1.message!));
    });

    it('filters by a protocol across different message types', async () => {
      // scenario:
      //    alice creates (3) different message types all related to "proto1" (Configure, RecordsWrite, RecordsDelete)
      //    alice creates (3) different message types all related to "proto2" (Configure, RecordsWrite, RecordsDelete)
      //    when issuing an EventsQuery for the specific protocol, only Events related to it should be returned.
      //    alice then creates an additional messages to query after a cursor

      const alice = await TestDataGenerator.generateDidKeyPersona();

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
        author  : alice,
        filters : [{ protocol: proto1 }],
        cursor  : proto1EventsReply.cursor,
      });
      proto1EventsReply = await dwn.processMessage(alice.did, proto1EventsQuery.message);
      expect(proto1EventsReply.status.code).equals(200);
      expect(proto1EventsReply.entries?.length).equals(1);
      expect(proto1EventsReply.entries![0]).to.equal(await Message.getCid(deleteProto1Message.message));

      //query messages beyond the cursor
      proto2EventsQuery = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [{ protocol: proto2 }],
        cursor  : proto2EventsReply.cursor,
      });
      proto2EventsReply = await dwn.processMessage(alice.did, proto2EventsQuery.message);
      expect(proto2EventsReply.status.code).equals(200);
      expect(proto2EventsReply.entries?.length).equals(1);
      expect(proto2EventsReply.entries![0]).to.equal(await Message.getCid(deleteProto2Message.message));
    });
  });
};