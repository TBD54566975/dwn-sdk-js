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
import { PermissionGrant } from '../../src/protocols/permission-grant.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { DataStream, Dwn, DwnInterfaceName, DwnMethodName, Jws, Message, PermissionsProtocol, Time } from '../../src/index.js';
import { DidKey, UniversalResolver } from '@web5/dids';

export function testMessagesQueryScenarios(): void {
  describe('messages query tests', () => {
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

      const messagesQueryRecords = await TestDataGenerator.generateMessagesQuery({
        author  : alice,
        filters : [
          { interface: DwnInterfaceName.Records }, // returns the RecordsWrite
          { protocol: protocol.message.descriptor.definition.protocol } // returns the ProtocolConfigure
        ],
      });
      const recordMessagesReply = await dwn.processMessage(alice.did, messagesQueryRecords.message);
      expect(recordMessagesReply.status.code).to.equal(200);
      expect(recordMessagesReply.entries?.length).to.equal(2);
      expect(recordMessagesReply.entries).to.have.members([
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

      let messagesQueryRecords = await TestDataGenerator.generateMessagesQuery({
        author  : alice,
        filters : [{ interface: DwnInterfaceName.Records }],
      });
      const recordMessagesReply = await dwn.processMessage(alice.did, messagesQueryRecords.message);
      expect(recordMessagesReply.status.code).to.equal(200);
      expect(recordMessagesReply.entries?.length).to.equal(1);
      expect(recordMessagesReply.entries![0]).to.equal(await Message.getCid(record.message!));

      let messagesQueryProtocols = await TestDataGenerator.generateMessagesQuery({
        author  : alice,
        filters : [{ interface: DwnInterfaceName.Protocols }],
      });
      const protocolMessagesReply = await dwn.processMessage(alice.did, messagesQueryProtocols.message);
      expect(protocolMessagesReply.status.code).to.equal(200);
      expect(protocolMessagesReply.entries?.length).to.equal(1);
      expect(protocolMessagesReply.entries![0]).to.equal(await Message.getCid(protocol.message!));


      // insert additional data to query beyond a cursor
      const recordDelete = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: record.message.recordId });
      const recordDeleteReply = await dwn.processMessage(alice.did, recordDelete.message);
      expect(recordDeleteReply.status.code).to.equal(202, 'RecordsDelete');

      // query after cursor
      messagesQueryRecords = await TestDataGenerator.generateMessagesQuery({
        author  : alice,
        filters : [{ interface: DwnInterfaceName.Records }],
        cursor  : recordMessagesReply.cursor, // the cursor from the prior query
      });
      const recordMessagesReplyAfterCursor = await dwn.processMessage(alice.did, messagesQueryRecords.message);
      expect(recordMessagesReplyAfterCursor.status.code).to.equal(200);
      expect(recordMessagesReplyAfterCursor.entries?.length).to.equal(1);
      expect(recordMessagesReplyAfterCursor.entries![0]).to.equal(await Message.getCid(recordDelete.message!));

      messagesQueryProtocols = await TestDataGenerator.generateMessagesQuery({
        author  : alice,
        filters : [{ interface: DwnInterfaceName.Protocols }],
        cursor  : protocolMessagesReply.cursor, // the cursor from the prior query
      });
      const protocolMessagesReplyAfterCursor = await dwn.processMessage(alice.did, messagesQueryProtocols.message);
      expect(protocolMessagesReplyAfterCursor.status.code).to.equal(200);
      expect(protocolMessagesReplyAfterCursor.entries?.length).to.equal(0); // no new messages
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


      let recordsWriteEvents = await TestDataGenerator.generateMessagesQuery({
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

      recordsWriteEvents = await TestDataGenerator.generateMessagesQuery({
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
      let messagesQuery1 = await TestDataGenerator.generateMessagesQuery({
        author  : alice,
        filters : [{ messageTimestamp: { from: lastDayOf2021 } }],
      });
      let reply1 = await dwn.processMessage(alice.did, messagesQuery1.message);
      expect(reply1.status.code).to.equal(200);
      expect(reply1.entries?.length).to.equal(1);
      expect(reply1.entries![0]).to.equal(await Message.getCid(protocol.message!));

      // delete the RecordsWrite
      const delete1 = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: write.message.recordId });
      const delete1Reply = await dwn.processMessage(alice.did, delete1.message);
      expect(delete1Reply.status.code).to.equal(202);

      messagesQuery1 = await TestDataGenerator.generateMessagesQuery({
        author  : alice,
        filters : [{ messageTimestamp: { from: lastDayOf2021 } }],
        cursor  : reply1.cursor
      });
      reply1 = await dwn.processMessage(alice.did, messagesQuery1.message);
      expect(reply1.status.code).to.equal(200);
      expect(reply1.entries?.length).to.equal(1);
      expect(reply1.entries![0]).to.equal(await Message.getCid(delete1.message!));
    });

    it('filters by a protocol across different message types', async () => {
      // NOTE: This test validates the ability to filter by a specific protocol across different message types.
      //       This will return any of the `RecordsWrite`, `RecordsDelete` and `ProtocolConfigure` messages that are associated with the protocol
      //       Additionally this will return permission-protocol `RecordsWrite` messages that are associated with the protocol.

      //       `RecordsDelete` messages associated with requests/grants/revocations are not yet indexed.
      //       TODO: https://github.com/TBD54566975/dwn-sdk-js/issues/768

      // scenario:
      //    alice configures two different protocols (proto1, proto2)
      //    alice creates records for each protocol
      //    bob requests permissions for both protocols
      //    alice grants bob permissions for both protocols
      //    when issuing an MessagesQuery for the specific protocol, only Events related to it should be returned.
      //    alice then deletes the records for each protocol
      //    alice revokes bob's permissions for both protocols
      //    now when issuing an MessagesQuery for the specific protocol givin a cursor, only the latest event should be returned.

      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();

      // create a proto1
      const protoConf1 = await TestDataGenerator.generateProtocolsConfigure({
        author             : alice,
        protocolDefinition : { ...freeForAll, protocol: 'proto1' }
      });

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

      const postProperties = {
        protocolPath : 'post',
        schema       : freeForAll.types.post.schema,
        dataFormat   : freeForAll.types.post.dataFormats[0],
      };

      // create a record for proto1
      const write1proto1 = await TestDataGenerator.generateRecordsWrite({ author: alice, protocol: proto1, ...postProperties });
      const write1Response = await dwn.processMessage(alice.did, write1proto1.message, { dataStream: write1proto1.dataStream });
      expect(write1Response.status.code).equals(202);

      // create a record for proto2
      const write1proto2 = await TestDataGenerator.generateRecordsWrite({ author: alice, protocol: proto2, ...postProperties });
      const write1Proto2Response = await dwn.processMessage(alice.did, write1proto2.message, { dataStream: write1proto2.dataStream });
      expect(write1Proto2Response.status.code).equals(202);

      // bob requests permissions for proto 1
      const requestProto1 = await PermissionsProtocol.createRequest({
        signer    : Jws.createSigner(bob),
        scope     : { interface: DwnInterfaceName.Records, method: DwnMethodName.Write, protocol: proto1 },
        delegated : false,
      });
      const requestProto1Response = await dwn.processMessage(
        alice.did,
        requestProto1.recordsWrite.message,
        { dataStream: DataStream.fromBytes(requestProto1.permissionRequestBytes) }
      );
      expect(requestProto1Response.status.code).equals(202);

      // bob requests permissions for proto 2
      const requestProto2 = await PermissionsProtocol.createRequest({
        signer    : Jws.createSigner(bob),
        scope     : { interface: DwnInterfaceName.Records, method: DwnMethodName.Write, protocol: proto2 },
        delegated : false,
      });
      const requestProto2Response = await dwn.processMessage(
        alice.did,
        requestProto2.recordsWrite.message,
        { dataStream: DataStream.fromBytes(requestProto2.permissionRequestBytes) }
      );
      expect(requestProto2Response.status.code).equals(202);

      // alice grants bob permissions for proto 1
      const grantProto1 = await PermissionsProtocol.createGrant({
        signer      : Jws.createSigner(alice),
        scope       : requestProto1.permissionRequestData.scope,
        dateExpires : Time.createOffsetTimestamp({ seconds: 5 }),
        grantedTo   : bob.did,
      });
      const grantProto1Response = await dwn.processMessage(
        alice.did,
        grantProto1.recordsWrite.message,
        { dataStream: DataStream.fromBytes(grantProto1.permissionGrantBytes) }
      );
      expect(grantProto1Response.status.code).equals(202);

      // alice grants bob permissions for proto 2
      const grantProto2 = await PermissionsProtocol.createGrant({
        signer      : Jws.createSigner(alice),
        scope       : requestProto2.permissionRequestData.scope,
        dateExpires : Time.createOffsetTimestamp({ seconds: 5 }),
        grantedTo   : bob.did,
      });
      const grantProto2Response = await dwn.processMessage(
        alice.did,
        grantProto2.recordsWrite.message,
        { dataStream: DataStream.fromBytes(grantProto2.permissionGrantBytes) }
      );
      expect(grantProto2Response.status.code).equals(202);

      // filter for proto1 messages
      let proto1MessagesQuery = await TestDataGenerator.generateMessagesQuery({
        author  : alice,
        filters : [{ protocol: proto1 }]
      });
      let proto1EventsReply = await dwn.processMessage(alice.did, proto1MessagesQuery.message);
      expect(proto1EventsReply.status.code).equals(200);
      expect(proto1EventsReply.entries?.length).equals(4); // configure, write, request, grant
      expect(proto1EventsReply.entries).to.have.members([
        await Message.getCid(protoConf1.message),
        await Message.getCid(write1proto1.message),
        await Message.getCid(requestProto1.recordsWrite.message),
        await Message.getCid(grantProto1.recordsWrite.message),
      ]);

      // filter for proto2
      let proto2MessagesQuery = await TestDataGenerator.generateMessagesQuery({
        author  : alice,
        filters : [{ protocol: proto2 }]
      });
      let proto2EventsReply = await dwn.processMessage(alice.did, proto2MessagesQuery.message);
      expect(proto2EventsReply.status.code).equals(200);
      expect(proto2EventsReply.entries?.length).equals(4); // configure, write, request, grant
      expect(proto2EventsReply.entries).to.have.members([
        await Message.getCid(protoConf2.message),
        await Message.getCid(write1proto2.message),
        await Message.getCid(requestProto2.recordsWrite.message),
        await Message.getCid(grantProto2.recordsWrite.message),
      ]);

      // delete proto1 message
      const deleteProto1Message = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: write1proto1.message.recordId });
      const deleteProto1MessageReply = await dwn.processMessage(alice.did, deleteProto1Message.message);
      expect(deleteProto1MessageReply.status.code).to.equal(202);

      // delete proto2 message
      const deleteProto2Message = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: write1proto2.message.recordId });
      const deleteProto2MessageReply = await dwn.processMessage(alice.did, deleteProto2Message.message);
      expect(deleteProto2MessageReply.status.code).to.equal(202);

      // revoke permissions for proto1
      const revokeProto1 = await PermissionsProtocol.createRevocation({
        signer : Jws.createSigner(alice),
        grant  : new PermissionGrant(grantProto1.dataEncodedMessage),
      });
      const revokeProto1Response = await dwn.processMessage(
        alice.did,
        revokeProto1.recordsWrite.message,
        { dataStream: DataStream.fromBytes(revokeProto1.permissionRevocationBytes) }
      );
      expect(revokeProto1Response.status.code).equals(202);

      // revoke permissions for proto2
      const revokeProto2 = await PermissionsProtocol.createRevocation({
        signer : Jws.createSigner(alice),
        grant  : new PermissionGrant(grantProto2.dataEncodedMessage),
      });
      const revokeProto2Response = await dwn.processMessage(
        alice.did,
        revokeProto2.recordsWrite.message,
        { dataStream: DataStream.fromBytes(revokeProto2.permissionRevocationBytes) }
      );
      expect(revokeProto2Response.status.code).equals(202);

      //query messages beyond the cursor
      proto1MessagesQuery = await TestDataGenerator.generateMessagesQuery({
        author  : alice,
        filters : [{ protocol: proto1 }],
        cursor  : proto1EventsReply.cursor,
      });
      proto1EventsReply = await dwn.processMessage(alice.did, proto1MessagesQuery.message);
      expect(proto1EventsReply.status.code).equals(200);
      expect(proto1EventsReply.entries?.length).equals(2); // delete, revoke
      expect(proto1EventsReply.entries).to.have.members([
        await Message.getCid(deleteProto1Message.message),
        await Message.getCid(revokeProto1.recordsWrite.message),
      ]);

      //query messages beyond the cursor
      proto2MessagesQuery = await TestDataGenerator.generateMessagesQuery({
        author  : alice,
        filters : [{ protocol: proto2 }],
        cursor  : proto2EventsReply.cursor,
      });
      proto2EventsReply = await dwn.processMessage(alice.did, proto2MessagesQuery.message);
      expect(proto2EventsReply.status.code).equals(200);
      expect(proto2EventsReply.entries?.length).equals(2); // delete, revoke
      expect(proto2EventsReply.entries).to.have.members([
        await Message.getCid(deleteProto2Message.message),
        await Message.getCid(revokeProto2.recordsWrite.message),
      ]);

      // query for proto1 messages again after the curser, should get nothing
      proto1MessagesQuery = await TestDataGenerator.generateMessagesQuery({
        author  : alice,
        filters : [{ protocol: proto1 }],
        cursor  : proto1EventsReply.cursor,
      });
      proto1EventsReply = await dwn.processMessage(alice.did, proto1MessagesQuery.message);
      expect(proto1EventsReply.status.code).equals(200);
      expect(proto1EventsReply.entries?.length).equals(0);

      // query for proto2 messages again after the curser, should get nothing
      proto2MessagesQuery = await TestDataGenerator.generateMessagesQuery({
        author  : alice,
        filters : [{ protocol: proto2 }],
        cursor  : proto2EventsReply.cursor,
      });
      proto2EventsReply = await dwn.processMessage(alice.did, proto2MessagesQuery.message);
      expect(proto2EventsReply.status.code).equals(200);
      expect(proto2EventsReply.entries?.length).equals(0);
    });
  });
};