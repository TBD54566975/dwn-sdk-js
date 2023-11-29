import type {
  DataStore,
  EventLog,
  MessageStore
} from '../../src/index.js';

import freeForAll from '../vectors/protocol-definitions/free-for-all.json' assert { type: 'json' };
import threadProtocol from '../vectors/protocol-definitions/thread-role.json' assert { type: 'json' };

import { TestStores } from '../test-stores.js';
import { DidKeyResolver, DidResolver, Dwn, DwnInterfaceName, DwnMethodName, Message, Time } from '../../src/index.js';

import { expect } from 'chai';
import { TestDataGenerator } from '../utils/test-data-generator.js';

export function testEventsQueryScenarios(): void {
  describe('events query tests', () => {
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

    it('supports multiple filter types', async () => {
      const alice = await DidKeyResolver.generate();
      const record = await TestDataGenerator.generateRecordsWrite({ author: alice });
      const grant = await TestDataGenerator.generatePermissionsGrant({ author: alice });
      const protocol = await TestDataGenerator.generateProtocolsConfigure({ author: alice });

      // insert data
      const recordReply = await dwn.processMessage(alice.did, record.message, record.dataStream);
      const grantReply = await dwn.processMessage(alice.did, grant.message);
      const protocolReply = await dwn.processMessage(alice.did, protocol.message);
      expect(recordReply.status.code).to.equal(202, 'RecordsWrite');
      expect(grantReply.status.code).to.equal(202, 'PermissionsGrant');
      expect(protocolReply.status.code).to.equal(202, 'ProtocolConfigure');

      const eventsQueryRecords = await TestDataGenerator.generateEventsQuery({
        author  : alice,
        filters : [
          { interface: DwnInterfaceName.Permissions }, //EventsMessageFilter
          { recordId: record.message.recordId }, // EventsRecordsFilter
          { protocol: protocol.message.descriptor.definition.protocol } // ProtocolsQueryFilter
        ],
      });
      const recordEventsReply = await dwn.processMessage(alice.did, eventsQueryRecords.message);
      expect(recordEventsReply.status.code).to.equal(200);
      expect(recordEventsReply.events?.length).to.equal(3);
      expect(recordEventsReply.events).to.have.members([
        await Message.getCid(record.message),
        await Message.getCid(grant.message),
        await Message.getCid(protocol.message),
      ]);
    });

    describe('EventsFilter', () => {
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
        const recordReply = await dwn.processMessage(alice.did, record.message, record.dataStream);
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
        expect(recordEventsReply.events?.length).to.equal(1);
        expect(recordEventsReply.events![0]).to.equal(await Message.getCid(record.message!));

        let eventsQueryGrants = await TestDataGenerator.generateEventsQuery({
          author  : alice,
          filters : [{ interface: DwnInterfaceName.Permissions }],
        });
        const grantEventsReply = await dwn.processMessage(alice.did, eventsQueryGrants.message);
        expect(grantEventsReply.status.code).to.equal(200);
        expect(grantEventsReply.events?.length).to.equal(1);
        expect(grantEventsReply.events![0]).to.equal(await Message.getCid(grant.message!));

        let eventsQueryProtocols = await TestDataGenerator.generateEventsQuery({
          author  : alice,
          filters : [{ interface: DwnInterfaceName.Protocols }],
        });
        const protocolEventsReply = await dwn.processMessage(alice.did, eventsQueryProtocols.message);
        expect(protocolEventsReply.status.code).to.equal(200);
        expect(protocolEventsReply.events?.length).to.equal(1);
        expect(protocolEventsReply.events![0]).to.equal(await Message.getCid(protocol.message!));


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
          cursor  : recordEventsReply.events![0], // the message returned from prior query
          author  : alice,
          filters : [{ interface: DwnInterfaceName.Records }],
        });
        const recordEventsReplyAfterCursor = await dwn.processMessage(alice.did, eventsQueryRecords.message);
        expect(recordEventsReplyAfterCursor.status.code).to.equal(200);
        expect(recordEventsReplyAfterCursor.events?.length).to.equal(1);
        expect(recordEventsReplyAfterCursor.events![0]).to.equal(await Message.getCid(recordDelete.message!));

        eventsQueryGrants = await TestDataGenerator.generateEventsQuery({
          cursor  : grantEventsReply.events![0], // the message returned from prior query
          author  : alice,
          filters : [{ interface: DwnInterfaceName.Permissions }],
        });
        const grantEventsReplyAfterCursor = await dwn.processMessage(alice.did, eventsQueryGrants.message);
        expect(grantEventsReplyAfterCursor.status.code).to.equal(200);
        expect(grantEventsReplyAfterCursor.events?.length).to.equal(1);
        expect(grantEventsReplyAfterCursor.events![0]).to.equal(await Message.getCid(revokeGrant.message!));

        eventsQueryProtocols = await TestDataGenerator.generateEventsQuery({
          cursor  : protocolEventsReply.events![0], // the message returned from prior query
          author  : alice,
          filters : [{ interface: DwnInterfaceName.Protocols }],
        });
        const protocolEventsReplyAfterCursor = await dwn.processMessage(alice.did, eventsQueryProtocols.message);
        expect(protocolEventsReplyAfterCursor.status.code).to.equal(200);
        expect(protocolEventsReplyAfterCursor.events?.length).to.equal(0); // no new messages
      });

      it('filters by method type', async () => {
        // scenario:
        // alice creates a variety of Messages (RecordsWrite, RecordsDelete, ProtocolConfigure, PermissionsGrant)
        // alice queries for only RecordsWrite messages
        // alice creates more messages to query beyond a cursor

        const alice = await DidKeyResolver.generate();

        // write 1
        const record1 = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const record1Reply = await dwn.processMessage(alice.did, record1.message, record1.dataStream);
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
        const record2Reply = await dwn.processMessage(alice.did, record2.message, record2.dataStream);
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
        expect(recordsWriteEventsReply.events?.length).to.equal(2);
        expect(recordsWriteEventsReply.events![0]).to.equal(await Message.getCid(record1.message));
        expect(recordsWriteEventsReply.events![1]).to.equal(await Message.getCid(record2.message));

        // additional messages
        const record2Update = await TestDataGenerator.generateFromRecordsWrite({ author: alice, existingWrite: record2.recordsWrite });
        const revokeGrant = await TestDataGenerator.generatePermissionsRevoke({
          author: alice, permissionsGrantId: await Message.getCid(grant.message)
        });
        const record2UpdateReply = await dwn.processMessage(alice.did, record2Update.message, record2Update.dataStream);
        const revokeGrantReply = await dwn.processMessage(alice.did, revokeGrant.message);
        expect(record2UpdateReply.status.code).to.equal(202, 'RecordsDelete');
        expect(revokeGrantReply.status.code).to.equal(202, 'PermissionsRevoke');

        recordsWriteEvents = await TestDataGenerator.generateEventsQuery({
          cursor  : recordsWriteEventsReply.events![1],
          author  : alice,
          filters : [{ interface: DwnInterfaceName.Records, method: DwnMethodName.Write }]
        });

        const recordsWriteEventsReplyAfterCursor = await dwn.processMessage(alice.did, recordsWriteEvents.message);
        expect(recordsWriteEventsReplyAfterCursor.status.code).to.equal(200);
        expect(recordsWriteEventsReplyAfterCursor.events?.length).to.equal(1);
        expect(recordsWriteEventsReplyAfterCursor.events![0]).to.equal(await Message.getCid(record2Update.message));
      });

      it('filters by a dateUpdated range across different message types', async () => {
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
        const writeReply = await dwn.processMessage(alice.did, write.message, write.dataStream);
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
        expect(reply1.events?.length).to.equal(2);
        expect(reply1.events![0]).to.equal(await Message.getCid(grant.message!));
        expect(reply1.events![1]).to.equal(await Message.getCid(protocol.message!));


        // delete the RecordsWrite
        const delete1 = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: write.message.recordId });
        const delete1Reply = await dwn.processMessage(alice.did, delete1.message);
        expect(delete1Reply.status.code).to.equal(202);

        eventsQuery1 = await TestDataGenerator.generateEventsQuery({
          cursor  : reply1.events![1], // use the last messageCid from the prior query as a cursor
          author  : alice,
          filters : [{ dateUpdated: { from: lastDayOf2021 } }],
        });
        reply1 = await dwn.processMessage(alice.did, eventsQuery1.message);
        expect(reply1.status.code).to.equal(200);
        expect(reply1.events?.length).to.equal(1);
        expect(reply1.events![0]).to.equal(await Message.getCid(delete1.message!));
      });

      it('filters by protocol', async () => {
        // scenario: get all messages across a protocol
        // alice installs two protocols and creates a thread in each.
        // alice adds bob as a participant to protocol1
        // alice and bob both create messages for protocol1
        // alice creates messages for protocol2
        // filter for each protocol to get their respective messages
        // add more messages to protocol1 and query after the cursor for protocol1
        // query after a cursor for protocol2 for no results as expected

        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();

        // create a thread protocol1
        const protocol1Configure = await TestDataGenerator.generateProtocolsConfigure({
          author             : alice,
          protocolDefinition : { ...threadProtocol }
        });
        const protocol1Reply = await dwn.processMessage(alice.did, protocol1Configure.message);
        expect(protocol1Reply.status.code).to.equal(202);
        const protocol1 = protocol1Configure.message.descriptor.definition.protocol;

        // create a thread protocol2
        const protocol2Configure = await TestDataGenerator.generateProtocolsConfigure({
          author             : alice,
          protocolDefinition : { ...threadProtocol, protocol: 'proto-2' }
        });
        const protocol2ConfigureReply = await dwn.processMessage(alice.did, protocol2Configure.message);
        expect(protocol2ConfigureReply.status.code).to.equal(202);
        const protocol2 = protocol2Configure.message.descriptor.definition.protocol;

        // alice creates thread in the protocol1
        const thread = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : protocol1,
          protocolPath : 'thread'
        });
        const threadReply = await dwn.processMessage(alice.did, thread.message, thread.dataStream);
        expect(threadReply.status.code).to.equal(202);

        // alice creates thread in the protocol2
        const threadProto2 = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : protocol2,
          protocolPath : 'thread'
        });
        const threadProto2Reply = await dwn.processMessage(alice.did, threadProto2.message, threadProto2.dataStream);
        expect(threadProto2Reply.status.code).to.equal(202);

        // add bob as participant to protocol1
        const bobParticipant = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          recipient    : bob.did,
          parentId     : thread.message.recordId,
          contextId    : thread.message.contextId,
          protocol     : protocol1,
          protocolPath : 'thread/participant'
        });
        const bobParticipantReply = await dwn.processMessage(alice.did, bobParticipant.message, bobParticipant.dataStream);
        expect(bobParticipantReply.status.code).to.equal(202);

        // bob creates a message for protocol1
        const bobMessage1 = await TestDataGenerator.generateRecordsWrite({
          author       : bob,
          recipient    : alice.did,
          parentId     : thread.message.recordId,
          contextId    : thread.message.contextId,
          protocol     : protocol1,
          protocolPath : 'thread/chat',
          protocolRole : 'thread/participant',
        });
        const bobMessage1Reply = await dwn.processMessage(alice.did, bobMessage1.message, bobMessage1.dataStream);
        expect(bobMessage1Reply.status.code).to.equal(202);

        // alice creates a message for protocol1
        const aliceMessage1 = await TestDataGenerator.generateRecordsWrite({
          author       : bob,
          recipient    : alice.did,
          parentId     : thread.message.recordId,
          contextId    : thread.message.contextId,
          protocol     : protocol1,
          protocolPath : 'thread/chat',
          protocolRole : 'thread/participant',
        });
        const aliceMessage1Reply = await dwn.processMessage(alice.did, aliceMessage1.message, aliceMessage1.dataStream);
        expect(aliceMessage1Reply.status.code).to.equal(202);

        // query for protocol1 events
        let protocolEventsQuery = await TestDataGenerator.generateEventsQuery({
          author  : alice,
          filters : [{ protocol: protocol1 }],
        });
        let protocolEventsQueryReply = await dwn.processMessage(alice.did, protocolEventsQuery.message);
        expect(protocolEventsQueryReply.status.code).to.equal(200);
        expect(protocolEventsQueryReply.events?.length).to.equal(5);
        // in the order they were written
        expect(protocolEventsQueryReply.events![0]).to.equal(await Message.getCid(protocol1Configure.message));
        expect(protocolEventsQueryReply.events![1]).to.equal(await Message.getCid(thread.message));
        expect(protocolEventsQueryReply.events![2]).to.equal(await Message.getCid(bobParticipant.message));
        expect(protocolEventsQueryReply.events![3]).to.equal(await Message.getCid(bobMessage1.message));
        expect(protocolEventsQueryReply.events![4]).to.equal(await Message.getCid(aliceMessage1.message));

        // query for protocol2 events
        let protocol2EventsQuery = await TestDataGenerator.generateEventsQuery({
          author  : alice,
          filters : [{ protocol: protocol2 }],
        });
        let protocol2EventsQueryReply = await dwn.processMessage(alice.did, protocol2EventsQuery.message);
        expect(protocol2EventsQueryReply.status.code).to.equal(200);
        expect(protocol2EventsQueryReply.events?.length).to.equal(2);
        expect(protocol2EventsQueryReply.events![0]).to.equal(await Message.getCid(protocol2Configure.message));
        expect(protocol2EventsQueryReply.events![1]).to.equal(await Message.getCid(threadProto2.message));

        // alice adds another message to protocol1
        const aliceMessage2 = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          recipient    : bob.did,
          parentId     : thread.message.recordId,
          contextId    : thread.message.contextId,
          protocol     : protocol1,
          protocolPath : 'thread/chat',
          protocolRole : 'thread/participant',
        });
        const aliceMessage2Reply = await dwn.processMessage(alice.did, aliceMessage2.message, aliceMessage2.dataStream);
        expect(aliceMessage2Reply.status.code).to.equal(202);

        // bob adds another message to protocol1
        const bobMessage3 = await TestDataGenerator.generateRecordsWrite({
          author       : bob,
          recipient    : alice.did,
          parentId     : thread.message.recordId,
          contextId    : thread.message.contextId,
          protocol     : protocol1,
          protocolPath : 'thread/chat',
          protocolRole : 'thread/participant',
        });
        const bobMessage3Reply = await dwn.processMessage(alice.did, bobMessage3.message, bobMessage3.dataStream);
        expect(bobMessage3Reply.status.code).to.equal(202);

        // query protocol1 after cursor
        const protocolCursor = protocolEventsQueryReply.events![4];
        protocolEventsQuery = await TestDataGenerator.generateEventsQuery({
          author  : alice,
          filters : [{ protocol: protocol1 }],
          cursor  : protocolCursor,
        });
        protocolEventsQueryReply = await dwn.processMessage(alice.did, protocolEventsQuery.message);
        expect(protocolEventsQueryReply.status.code).to.equal(200);
        expect(protocolEventsQueryReply.events?.length).to.equal(2);
        expect(protocolEventsQueryReply.events![0]).to.equal(await Message.getCid(aliceMessage2.message));
        expect(protocolEventsQueryReply.events![1]).to.equal(await Message.getCid(bobMessage3.message));

        // query protocol2 after cursor (should return no events)
        const protocol2Cursor = protocol2EventsQueryReply.events![1];
        protocol2EventsQuery = await TestDataGenerator.generateEventsQuery({
          author  : alice,
          filters : [{ protocol: protocol2 }],
          cursor  : protocol2Cursor,
        });
        protocol2EventsQueryReply = await dwn.processMessage(alice.did, protocol2EventsQuery.message);
        expect(protocol2EventsQueryReply.status.code).to.equal(200);
        expect(protocol2EventsQueryReply.events?.length).to.equal(0);

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
        const threadReply = await dwn.processMessage(alice.did, thread.message, thread.dataStream);
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
        const bobParticipantReply = await dwn.processMessage(alice.did, bobParticipant.message, bobParticipant.dataStream);
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
        const carolParticipantReply = await dwn.processMessage(alice.did, carolParticipant.message, carolParticipant.dataStream);
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
        const message1Reply = await dwn.processMessage(alice.did, message1.message, message1.dataStream);
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
        const message2Reply = await dwn.processMessage(alice.did, message2.message, message2.dataStream);
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
        const message3Reply = await dwn.processMessage(alice.did, message3.message, message3.dataStream);
        expect(message3Reply.status.code).to.equal(202);

        // query for thread
        const threadQuery = await TestDataGenerator.generateEventsQuery({
          author  : alice,
          filters : [{ protocol: protocol, protocolPath: 'thread' }],
        });
        const threadQueryReply = await dwn.processMessage(alice.did, threadQuery.message);
        expect(threadQueryReply.status.code).to.equal(200);
        expect(threadQueryReply.events?.length).to.equal(1);
        expect(threadQueryReply.events![0]).to.equal(await Message.getCid(thread.message));

        // query for participants
        const participantsQuery = await TestDataGenerator.generateEventsQuery({
          author  : alice,
          filters : [{ protocol: protocol, protocolPath: 'thread/participant', parentId: thread.message.recordId }],
        });
        const participantsQueryReply = await dwn.processMessage(alice.did, participantsQuery.message);
        expect(participantsQueryReply.status.code).to.equal(200);
        expect(participantsQueryReply.events?.length).to.equal(2);
        expect(participantsQueryReply.events![0]).to.equal(await Message.getCid(bobParticipant.message));
        expect(participantsQueryReply.events![1]).to.equal(await Message.getCid(carolParticipant.message));

        // query for chats
        const chatQuery = await TestDataGenerator.generateEventsQuery({
          author  : alice,
          filters : [{ protocol: protocol, protocolPath: 'thread/chat', parentId: thread.message.recordId }],
        });
        const chatQueryReply = await dwn.processMessage(alice.did, chatQuery.message);
        expect(chatQueryReply.status.code).to.equal(200);
        expect(chatQueryReply.events?.length).to.equal(3);
        expect(chatQueryReply.events![0]).to.equal(await Message.getCid(message1.message));
        expect(chatQueryReply.events![1]).to.equal(await Message.getCid(message2.message));
        expect(chatQueryReply.events![2]).to.equal(await Message.getCid(message3.message));
      });
    });

    describe('ProtocolsQueryFilter', () => {
      it('filters for events matching a protocol across different message types', async () => {
        // scenario:
        // alice creates (3) different message types all related to "proto1" (Configure, RecordsWrite, RecordsDelete)
        // alice creates (3) different message types all related to "proto2" (Configure, RecordsWrite, RecordsDelete)
        // when issuing an EventsQuery for the specific protocol, only Events related to it should be returned.
        // alice then creates an additional messages to query after a cursor

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
        const write1Response = await dwn.processMessage(alice.did, write1proto1.message, write1proto1.dataStream);
        expect(write1Response.status.code).equals(202);

        // create a record for proto2
        const write1proto2 = await TestDataGenerator.generateRecordsWrite({ author: alice, protocol: proto2, ...postProperties });
        const write1Proto2Response = await dwn.processMessage(alice.did, write1proto2.message, write1proto2.dataStream);
        expect(write1Proto2Response.status.code).equals(202);

        // filter for proto1
        let proto1EventsQuery = await TestDataGenerator.generateEventsQuery({
          author  : alice,
          filters : [{ protocol: proto1 }]
        });
        let proto1EventsReply = await dwn.processMessage(alice.did, proto1EventsQuery.message);
        expect(proto1EventsReply.status.code).equals(200);
        expect(proto1EventsReply.events?.length).equals(2);

        // check order of events returned.
        expect(proto1EventsReply.events![0]).to.equal(await Message.getCid(protoConf1.message));
        expect(proto1EventsReply.events![1]).to.equal(await Message.getCid(write1proto1.message));

        // filter for proto2
        let proto2EventsQuery = await TestDataGenerator.generateEventsQuery({
          author  : alice,
          filters : [{ protocol: proto2 }]
        });
        let proto2EventsReply = await dwn.processMessage(alice.did, proto2EventsQuery.message);
        expect(proto2EventsReply.status.code).equals(200);
        expect(proto2EventsReply.events?.length).equals(2);

        // check order of events returned.
        expect(proto2EventsReply.events![0]).to.equal(await Message.getCid(protoConf2.message));
        expect(proto2EventsReply.events![1]).to.equal(await Message.getCid(write1proto2.message));

        // get cursor of the last event and add more events to query afterwards
        const proto1Cursor = proto1EventsReply.events![1];
        const proto2Cursor = proto2EventsReply.events![1];

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
        expect(proto1EventsReply.events?.length).equals(1);
        expect(proto1EventsReply.events![0]).to.equal(await Message.getCid(deleteProto1Message.message));

        //query messages beyond the cursor
        proto2EventsQuery = await TestDataGenerator.generateEventsQuery({
          cursor  : proto2Cursor,
          author  : alice,
          filters : [{ protocol: proto2 }],
        });
        proto2EventsReply = await dwn.processMessage(alice.did, proto2EventsQuery.message);
        expect(proto2EventsReply.status.code).equals(200);
        expect(proto2EventsReply.events?.length).equals(1);
        expect(proto2EventsReply.events![0]).to.equal(await Message.getCid(deleteProto2Message.message));
      });
    });

    describe('EventsRecordsFilter', () => {
      xit('filters by recipient');
      xit('filters by protocolPath');
      xit('filters by contextId');
      xit('filters by schema');
      xit('filters by recordId');
      xit('filters by dataFormat');
      xit('filters by dateCreated', async () => {
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
    });
  });
};