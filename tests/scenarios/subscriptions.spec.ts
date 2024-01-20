import type {
  DataStore,
  EventLog,
  EventStream,
  GenericMessage,
  MessageStore,
} from '../../src/index.js';

import freeForAll from '../vectors/protocol-definitions/free-for-all.json' assert { type: 'json' };
import threadProtocol from '../vectors/protocol-definitions/thread-role.json' assert { type: 'json' };

import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { Time } from '../../src/utils/time.js';
import { DidKeyResolver, DidResolver, Dwn, DwnConstant, DwnInterfaceName, DwnMethodName, Message } from '../../src/index.js';

import { expect } from 'chai';

export function testSubscriptionScenarios(): void {
  describe('subscriptions', () => {
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

    describe('events subscribe', () => {
      it('all events', async () => {
        const alice = await DidKeyResolver.generate();

        // create a handler that adds the messageCid of each message to an array.
        const messageCids: string[] = [];
        const handler = async (message: GenericMessage): Promise<void> => {
          const messageCid = await Message.getCid(message);
          messageCids.push(messageCid);
        };

        // subscribe to all messages
        const eventsSubscription = await TestDataGenerator.generateEventsSubscribe({ author: alice });
        const eventsSubscriptionReply = await dwn.processMessage(alice.did, eventsSubscription.message, { subscriptionHandler: handler });
        expect(eventsSubscriptionReply.status.code).to.equal(200);
        expect(eventsSubscriptionReply.subscription?.id).to.equal(await Message.getCid(eventsSubscription.message));

        // generate various messages
        const write1 = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const write1MessageCid = await Message.getCid(write1.message);
        const write1Reply = await dwn.processMessage(alice.did, write1.message, { dataStream: write1.dataStream });
        expect(write1Reply.status.code).to.equal(202);

        const grant1 = await TestDataGenerator.generatePermissionsGrant({ author: alice });
        const grant1MessageCid = await Message.getCid(grant1.message);
        const grant1Reply = await dwn.processMessage(alice.did, grant1.message);
        expect(grant1Reply.status.code).to.equal(202);

        const protocol1 = await TestDataGenerator.generateProtocolsConfigure({ author: alice });
        const protocol1MessageCid = await Message.getCid(protocol1.message);
        const protocol1Reply = await dwn.processMessage(alice.did, protocol1.message);
        expect(protocol1Reply.status.code).to.equal(202);

        const deleteWrite1 = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: write1.message.recordId });
        const delete1MessageCid = await Message.getCid(deleteWrite1.message);
        const deleteWrite1Reply = await dwn.processMessage(alice.did, deleteWrite1.message);
        expect(deleteWrite1Reply.status.code).to.equal(202);

        // unregister the handler
        await eventsSubscriptionReply.subscription?.close();

        // create a message after
        const write2 = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const write2Reply = await dwn.processMessage(alice.did, write2.message, { dataStream: write2.dataStream });
        expect(write2Reply.status.code).to.equal(202);

        await Time.minimalSleep();

        // test the messageCids array for the appropriate messages
        expect(messageCids.length).to.equal(4);
        expect(messageCids).to.eql([ write1MessageCid, grant1MessageCid, protocol1MessageCid, delete1MessageCid ]);
      });

      it('filters by interface type', async () => {
        // scenario:
        // alice subscribes to 3 different message interfaces (Permissions, Records, Grants)
        // alice creates (3) messages, (RecordsWrite, PermissionsGrant and ProtocolsConfigure
        // alice checks that each handler emitted the appropriate message
        // alice deletes the record, and revokes the grant
        // alice checks that the Records and Permissions handlers emitted the appropriate message
        const alice = await DidKeyResolver.generate();

        // subscribe to records
        const recordsInterfaceSubscription = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [{ interface: DwnInterfaceName.Records }]
        });
        const recordsMessageCids:string[] = [];
        const recordsSubscribeHandler = async (message: GenericMessage):Promise<void> => {
          const messageCid = await Message.getCid(message);
          recordsMessageCids.push(messageCid);
        };

        const recordsInterfaceSubscriptionReply = await dwn.processMessage(
          alice.did,
          recordsInterfaceSubscription.message,
          { subscriptionHandler: recordsSubscribeHandler }
        );
        expect(recordsInterfaceSubscriptionReply.status.code).to.equal(200);
        expect(recordsInterfaceSubscriptionReply.subscription).to.exist;

        // subscribe to permissions
        const permissionsInterfaceSubscription = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [{ interface: DwnInterfaceName.Permissions }]
        });
        const permissionsMessageCids:string[] = [];
        const permissionsSubscribeHandler = async (message: GenericMessage):Promise<void> => {
          const messageCid = await Message.getCid(message);
          permissionsMessageCids.push(messageCid);
        };

        const permissionsInterfaceSubscriptionReply = await dwn.processMessage(
          alice.did,
          permissionsInterfaceSubscription.message,
          { subscriptionHandler: permissionsSubscribeHandler }
        );
        expect(permissionsInterfaceSubscriptionReply.status.code).to.equal(200);
        expect(permissionsInterfaceSubscriptionReply.subscription).to.exist;

        // subscribe to protocols
        const protocolsInterfaceSubscription = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [{ interface: DwnInterfaceName.Protocols }]
        });
        const protocolsMessageCids:string[] = [];
        const protocolsSubscribeHandler = async (message: GenericMessage):Promise<void> => {
          const messageCid = await Message.getCid(message);
          protocolsMessageCids.push(messageCid);
        };

        const protocolsInterfaceSubscriptionReply = await dwn.processMessage(
          alice.did,
          protocolsInterfaceSubscription.message,
          { subscriptionHandler: protocolsSubscribeHandler }
        );
        expect(protocolsInterfaceSubscriptionReply.status.code).to.equal(200);
        expect(protocolsInterfaceSubscriptionReply.subscription).to.exist;

        // create one of each message types
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

        // check record message
        expect(recordsMessageCids.length).to.equal(1);
        expect(recordsMessageCids).to.have.members([ await Message.getCid(record.message) ]);

        // check permissions message
        expect(permissionsMessageCids.length).to.equal(1);
        expect(permissionsMessageCids).to.have.members([ await Message.getCid(grant.message) ]);

        // check protocols message
        expect(protocolsMessageCids.length).to.equal(1);
        expect(protocolsMessageCids).to.have.members([ await Message.getCid(protocol.message) ]);

        // insert additional data to query beyond a cursor
        const recordDelete = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: record.message.recordId });
        const revokeGrant = await TestDataGenerator.generatePermissionsRevoke({
          author: alice, permissionsGrantId: await Message.getCid(grant.message)
        });
        const recordDeleteReply = await dwn.processMessage(alice.did, recordDelete.message);
        const revokeGrantReply = await dwn.processMessage(alice.did, revokeGrant.message);
        expect(recordDeleteReply.status.code).to.equal(202, 'RecordsDelete');
        expect(revokeGrantReply.status.code).to.equal(202, 'PermissionsRevoke');

        // check record messages to include the delete message
        expect(recordsMessageCids.length).to.equal(2);
        expect(recordsMessageCids).to.include.members([ await Message.getCid(recordDelete.message) ]);

        // check permissions messages to include the revoke message
        expect(permissionsMessageCids.length).to.equal(2);
        expect(permissionsMessageCids).to.include.members([ await Message.getCid(revokeGrant.message) ]);

        // protocols remains unchanged
        expect(protocolsMessageCids.length).to.equal(1);
      });

      it('filters by method type', async () => {
        // scenario:
        // alice creates a variety of Messages (RecordsWrite, RecordsDelete, ProtocolConfigure, PermissionsGrant)
        // alice queries for only RecordsWrite messages
        // alice creates more messages to query beyond a cursor

        const alice = await DidKeyResolver.generate();

        // subscribe to records write
        const recordsWriteSubscription = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [{ interface: DwnInterfaceName.Records, method: DwnMethodName.Write }]
        });
        const recordsMessageCids:string[] = [];
        const recordsSubscribeHandler = async (message: GenericMessage):Promise<void> => {
          const messageCid = await Message.getCid(message);
          recordsMessageCids.push(messageCid);
        };

        const recordsWriteSubscriptionReply = await dwn.processMessage(
          alice.did,
          recordsWriteSubscription.message,
          { subscriptionHandler: recordsSubscribeHandler }
        );
        expect(recordsWriteSubscriptionReply.status.code).to.equal(200);
        expect(recordsWriteSubscriptionReply.subscription).to.exist;

        // create one of each message types
        const record = await TestDataGenerator.generateRecordsWrite({ author: alice });

        // insert data
        const recordReply = await dwn.processMessage(alice.did, record.message, { dataStream: record.dataStream });
        expect(recordReply.status.code).to.equal(202, 'RecordsWrite');

        // sleep to make sure event was processed and added to array asynchronously
        await Time.minimalSleep();

        // check record message
        expect(recordsMessageCids.length).to.equal(1);
        expect(recordsMessageCids).to.have.members([ await Message.getCid(record.message) ]);

        // delete the message
        const recordDelete = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: record.message.recordId });
        const recordDeleteReply = await dwn.processMessage(alice.did, recordDelete.message);
        expect(recordDeleteReply.status.code).to.equal(202, 'RecordsDelete');

        // check record messages remain unchanged and do not include the delete since we only subscribe to writes
        expect(recordsMessageCids.length).to.equal(1);
      });

      it('filters by a protocol across different message types', async () => {
        // scenario:
        //    alice creates (3) different message types all related to "proto1" (Configure, RecordsWrite, RecordsDelete)
        //    alice creates (3) different message types all related to "proto2" (Configure, RecordsWrite, RecordsDelete)
        //    when subscribing for a specific protocol, only Messages related to it should be emitted.
        const alice = await DidKeyResolver.generate();

        const proto1Messages:string[] = [];
        const proto1Handler = async (message:GenericMessage):Promise<void> => {
          proto1Messages.push(await Message.getCid(message));
        };

        const proto1Subscription = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [{ protocol: 'http://proto1' }]
        });
        const proto1SubscriptionReply = await dwn.processMessage(alice.did, proto1Subscription.message, {
          subscriptionHandler: proto1Handler
        });
        expect(proto1SubscriptionReply.status.code).to.equal(200);
        expect(proto1SubscriptionReply.subscription).to.exist;

        const proto2Messages:string[] = [];
        const proto2Handler = async (message:GenericMessage):Promise<void> => {
          proto2Messages.push(await Message.getCid(message));
        };

        const proto2Subscription = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [{ protocol: 'http://proto2' }]
        });
        const proto2SubscriptionReply = await dwn.processMessage(alice.did, proto2Subscription.message, {
          subscriptionHandler: proto2Handler
        });
        expect(proto2SubscriptionReply.status.code).to.equal(200);
        expect(proto2SubscriptionReply.subscription).to.exist;

        // create a proto1
        const protoConf1 = await TestDataGenerator.generateProtocolsConfigure({
          author             : alice,
          protocolDefinition : { ...freeForAll, protocol: 'http://proto1' }
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
          protocolDefinition : { ...freeForAll, protocol: 'http://proto2' }
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

        // check for proto1 messages
        expect(proto1Messages.length).to.equal(2);
        expect(proto1Messages).to.have.members([ await Message.getCid(protoConf1.message), await Message.getCid(write1proto1.message) ]);

        // check for proto2 messages
        expect(proto2Messages.length).to.equal(2);
        expect(proto2Messages).to.have.members([ await Message.getCid(protoConf2.message), await Message.getCid(write1proto2.message) ]);

        // delete proto1 message
        const deleteProto1Message = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: write1proto1.message.recordId });
        const deleteProto1MessageReply = await dwn.processMessage(alice.did, deleteProto1Message.message);
        expect(deleteProto1MessageReply.status.code).to.equal(202);

        // delete proto2 message
        const deleteProto2Message = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: write1proto2.message.recordId });
        const deleteProto2MessageReply = await dwn.processMessage(alice.did, deleteProto2Message.message);
        expect(deleteProto2MessageReply.status.code).to.equal(202);

        // check for the delete in proto1 messages
        expect(proto1Messages.length).to.equal(3);
        expect(proto1Messages).to.include.members([ await Message.getCid(deleteProto1Message.message) ]);

        // check for the delete in proto2 messages
        expect(proto2Messages.length).to.equal(3);
        expect(proto2Messages).to.include.members([ await Message.getCid(deleteProto2Message.message) ]);
      });

      it('filters by protocol & parentId across multiple protocolPaths', async () => {
        // scenario: subscribe to multiple protocolPaths for a given protocol and parentId
        //    alice installs a protocol and creates a thread
        //    alice subscribes to update to that thread, it's participant as well as thread chats
        //    alice adds bob and carol as participants to the thread
        //    alice, bob, and carol all create messages
        //    alice deletes carol participant message
        //    alice checks that the correct messages were omitted

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


        // subscribe to this thread's events
        const messages:string[] = [];
        const subscriptionHandler = async (message:GenericMessage):Promise<void> => {
          messages.push(await Message.getCid(message));
        };

        const threadSubscription = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [
            { protocol: protocol, protocolPath: 'thread', parentId: thread.message.recordId }, // thread updates
            { protocol: protocol, protocolPath: 'thread/participant', parentId: thread.message.recordId }, // participant updates
            { protocol: protocol, protocolPath: 'thread/chat', parentId: thread.message.recordId } // chat updates
          ],
        });
        const threadSubscriptionReply = await dwn.processMessage(alice.did, threadSubscription.message, {
          subscriptionHandler
        });
        expect(threadSubscriptionReply.status.code).to.equal(200);
        expect(threadSubscriptionReply.subscription).to.exist;

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

        // add another thread as a control, will not show up in handled events
        const additionalThread = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : protocol,
          protocolPath : 'thread'
        });
        const additionalThreadReply = await dwn.processMessage(alice.did, additionalThread.message, { dataStream: additionalThread.dataStream });
        expect(additionalThreadReply.status.code).to.equal(202);

        // sleep to allow all messages to be processed by the handler message
        await Time.minimalSleep();

        expect(messages.length).to.equal(2);
        expect(messages).to.have.members([
          await Message.getCid(bobParticipant.message),
          await Message.getCid(carolParticipant.message),
        ]);

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

        // sleep in order to allow messages to process and check for the added messages
        await Time.minimalSleep();
        expect(messages.length).to.equal(5);
        expect(messages).to.include.members([
          await Message.getCid(message1.message),
          await Message.getCid(message2.message),
          await Message.getCid(message3.message),
        ]);

        // delete carol participant
        const deleteCarol = await TestDataGenerator.generateRecordsDelete({
          author   : alice,
          recordId : carolParticipant.message.recordId
        });
        const deleteCarolReply = await dwn.processMessage(alice.did, deleteCarol.message);
        expect(deleteCarolReply.status.code).to.equal(202);

        // sleep in order to allow messages to process and check for the delete message
        await Time.minimalSleep();
        expect(messages.length).to.equal(6);
        expect(messages).to.include.members([
          await Message.getCid(deleteCarol.message)
        ]);
      });

      it('filters by schema', async () => {
        const alice = await DidKeyResolver.generate();

        // we will add messageCids to these arrays as they are received by their handler to check against later
        const schema1Messages:string[] = [];
        const schema2Messages:string[] = [];

        // we add a handler to the subscription and add the messageCid to the appropriate array
        const schema1Handler = async (message:GenericMessage):Promise<void> => {
          const messageCid = await Message.getCid(message);
          schema1Messages.push(messageCid);
        };

        // subscribe to schema1 messages
        const schema1Subscription = await TestDataGenerator.generateEventsSubscribe({ author: alice, filters: [{ schema: 'http://schema1' }] });
        const schema1SubscriptionReply = await dwn.processMessage(alice.did, schema1Subscription.message, { subscriptionHandler: schema1Handler });
        expect(schema1SubscriptionReply.status.code).to.equal(200);
        expect(schema1SubscriptionReply.subscription?.id).to.equal(await Message.getCid(schema1Subscription.message));

        // we add a handler to the subscription and add the messageCid to the appropriate array
        const schema2Handler = async (message:GenericMessage):Promise<void> => {
          const messageCid = await Message.getCid(message);
          schema2Messages.push(messageCid);
        };

        // subscribe to schema2 messages
        const schema2Subscription = await TestDataGenerator.generateEventsSubscribe({ author: alice, filters: [{ schema: 'http://schema2' }] });
        const schema2SubscriptionReply = await dwn.processMessage(alice.did, schema2Subscription.message, { subscriptionHandler: schema2Handler });
        expect(schema2SubscriptionReply.status.code).to.equal(200);
        expect(schema2SubscriptionReply.subscription?.id).to.equal(await Message.getCid(schema2Subscription.message));

        // create some random record, will not show up in records subscription
        const write1Random = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const write1RandomResponse = await dwn.processMessage(alice.did, write1Random.message, { dataStream: write1Random.dataStream });
        expect(write1RandomResponse.status.code).to.equal(202);

        // create a record for schema1
        const write1schema1 = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'http://schema1' });
        const write1Response = await dwn.processMessage(alice.did, write1schema1.message, { dataStream: write1schema1.dataStream });
        expect(write1Response.status.code).equals(202);

        // create a record for schema2
        const write1schema2 = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'http://schema2' });
        const write1Proto2Response = await dwn.processMessage(alice.did, write1schema2.message, { dataStream: write1schema2.dataStream });
        expect(write1Proto2Response.status.code).equals(202);

        expect(schema1Messages.length).to.equal(1, 'schema1');
        expect(schema1Messages).to.include(await Message.getCid(write1schema1.message));
        expect(schema2Messages.length).to.equal(1, 'schema2');
        expect(schema2Messages).to.include(await Message.getCid(write1schema2.message));

        // remove listener for schema1
        schema1SubscriptionReply.subscription?.close();

        // create another record for schema1
        const write2proto1 = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'http://schema1' });
        const write2Response = await dwn.processMessage(alice.did, write2proto1.message, { dataStream: write2proto1.dataStream });
        expect(write2Response.status.code).equals(202);

        // create another record for schema2
        const write2schema2 = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'http://schema2' });
        const write2Schema2Response = await dwn.processMessage(alice.did, write2schema2.message, { dataStream: write2schema2.dataStream });
        expect(write2Schema2Response.status.code).equals(202);

        // schema1 messages from handler do not change.
        expect(schema1Messages.length).to.equal(1, 'schema1 after close()');
        expect(schema1Messages).to.include(await Message.getCid(write1schema1.message));

        // schema2 messages from handler have the new message.
        expect(schema2Messages.length).to.equal(2, 'schema2 after close()');
        expect(schema2Messages).to.have.members([await Message.getCid(write1schema2.message), await Message.getCid(write2schema2.message)]);
      });

      it('filters by recordId', async () => {
        const alice = await DidKeyResolver.generate();

        const write = await TestDataGenerator.generateRecordsWrite({
          author : alice,
          schema : 'schema1'
        });
        const write1Reply = await dwn.processMessage(alice.did, write.message, { dataStream: write.dataStream });
        expect(write1Reply.status.code).to.equal(202);

        // create a subscription and capture the messages associated with the record
        const messages: string[] = [];
        const subscriptionHandler = async (message: GenericMessage):Promise<void> => {
          messages.push(await Message.getCid(message));
        };

        const recordIdSubscribe = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [{ recordId: write.message.recordId }]
        });
        const recordIdSubscribeReply = await dwn.processMessage(alice.did, recordIdSubscribe.message, {
          subscriptionHandler
        });
        expect(recordIdSubscribeReply.status.code).to.equal(200);

        // a write as a control, will not show up in subscription
        const controlWrite = await TestDataGenerator.generateRecordsWrite({
          author : alice,
          schema : 'schema1'
        });
        const write2Reply = await dwn.processMessage(alice.did, controlWrite.message, { dataStream: controlWrite.dataStream });
        expect(write2Reply.status.code).to.equal(202);

        // update record
        const update = await TestDataGenerator.generateFromRecordsWrite({
          author        : alice,
          existingWrite : write.recordsWrite,
        });
        const updateReply = await dwn.processMessage(alice.did, update.message, { dataStream: update.dataStream });
        expect(updateReply.status.code).to.equal(202);


        // sleep to allow all messages to be processed by the handler message
        await Time.minimalSleep();

        expect(messages.length).to.equal(1);
        expect(messages).to.have.members([ await Message.getCid(update.message) ]);

        const deleteRecord = await TestDataGenerator.generateRecordsDelete({
          author   : alice,
          recordId : write.message.recordId,
        });
        const deleteRecordReply = await dwn.processMessage(alice.did, deleteRecord.message);
        expect(deleteRecordReply.status.code).to.equal(202);

        // sleep to allow all messages to be processed by the handler message
        await Time.minimalSleep();

        expect(messages.length).to.equal(2);
        expect(messages).to.include.members([ await Message.getCid(deleteRecord.message) ]);
      });

      it('filters by recipient', async () => {
        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();
        const carol = await DidKeyResolver.generate();

        const receivedMessages:string[] = [];

        const handler = async (message:GenericMessage): Promise<void> => {
          const messageCid = await Message.getCid(message);
          receivedMessages.push(messageCid);
        };

        const recipientSubscription = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [{ recipient: alice.did }]
        });
        const authorQueryReply = await dwn.processMessage(alice.did, recipientSubscription.message, { subscriptionHandler: handler });
        expect(authorQueryReply.status.code).to.equal(200);

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

        expect(receivedMessages).to.have.members([
          await Message.getCid(messageFromBobToAlice.message),
          await Message.getCid(messageFromCarolToAlice.message)
        ]);

        // add another message
        const messageFromAliceToBob2 = await TestDataGenerator.generateRecordsWrite({
          ...postProperties,
          author    : alice,
          recipient : bob.did,
        });
        const messageFromAliceToBob2Reply =
          await dwn.processMessage(alice.did, messageFromAliceToBob2.message, { dataStream: messageFromAliceToBob2.dataStream });
        expect(messageFromAliceToBob2Reply.status.code).to.equal(202);

        expect(receivedMessages).to.not.include.members([ await Message.getCid(messageFromAliceToBob2.message)]);
      });

      it('filters by dataFormat', async () => {
        // scenario: alice stores different file types and needs events relating to `image/jpeg`
        //  alice creates 3 files, one of them `image/jpeg`
        //  alice queries for `image/jpeg` retrieving the one message
        //  alice adds another image to query for using the prior image as a cursor

        const alice = await DidKeyResolver.generate();

        const imageMessages: string[] = [];
        const imageHandler = async (message:GenericMessage):Promise<void> => {
          imageMessages.push(await Message.getCid(message));
        };

        const imageSubscription = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [{ dataFormat: 'image/jpeg' }]
        });
        const imageSubscriptionReply = await dwn.processMessage(alice.did, imageSubscription.message, {
          subscriptionHandler: imageHandler
        });
        expect(imageSubscriptionReply.status.code).to.equal(200);

        // write a text file
        const textFile = await TestDataGenerator.generateRecordsWrite({
          author     : alice,
          dataFormat : 'application/text'
        });
        const textFileReply = await dwn.processMessage(alice.did, textFile.message, { dataStream: textFile.dataStream });
        expect(textFileReply.status.code).to.equal(202);

        // write an application/json file
        const jsonData = await TestDataGenerator.generateRecordsWrite({
          author     : alice,
          dataFormat : 'application/json'
        });
        const jsonDataReply = await dwn.processMessage(alice.did, jsonData.message, { dataStream: jsonData.dataStream });
        expect(jsonDataReply.status.code).to.equal(202);

        // write an image
        const imageData = await TestDataGenerator.generateRecordsWrite({
          author     : alice,
          dataFormat : 'image/jpeg'
        });
        const imageDataReply = await dwn.processMessage(alice.did, imageData.message, { dataStream: imageData.dataStream });
        expect(imageDataReply.status.code).to.equal(202);


        // wait for messages to emit and handler to process
        await Time.minimalSleep();
        expect(imageMessages.length).to.equal(1);
        expect(imageMessages).to.have.members([ await Message.getCid(imageData.message) ]);

        // add another image
        const imageData2 = await TestDataGenerator.generateRecordsWrite({
          author     : alice,
          dataFormat : 'image/jpeg'
        });
        const imageData2Reply = await dwn.processMessage(alice.did, imageData2.message, { dataStream: imageData2.dataStream });
        expect(imageData2Reply.status.code).to.equal(202);

        // delete the first image
        const deleteImageData = await TestDataGenerator.generateRecordsDelete({
          author   : alice,
          recordId : imageData.message.recordId,
        });
        const deleteImageDataReply = await dwn.processMessage(alice.did, deleteImageData.message);
        expect(deleteImageDataReply.status.code).to.equal(202);

        // wait for messages to emit and handler to process
        await Time.minimalSleep();
        expect(imageMessages.length).to.equal(3);
        // check that the new image and the delete messages were emitted
        expect(imageMessages).to.include.members([
          await Message.getCid(imageData2.message),
          await Message.getCid(deleteImageData.message)
        ]);
      });;

      it('filters by dataSize', async () => {
        // scenario:
        //    alice subscribes to messages with data size under a threshold
        //    alice inserts both small and large data

        const alice = await DidKeyResolver.generate();

        const smallMessages: string[] = [];
        const subscriptionHandler = async (message:GenericMessage):Promise<void> => {
          smallMessages.push(await Message.getCid(message));
        };
        const smallMessageSubscription = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [{ dataSize: { lte: DwnConstant.maxDataSizeAllowedToBeEncoded } }]
        });
        const smallMessageSubscriptionReply = await dwn.processMessage(alice.did, smallMessageSubscription.message, {
          subscriptionHandler,
        });
        expect(smallMessageSubscriptionReply.status.code).to.equal(200);

        // add a small data size record
        const smallSize1 = await TestDataGenerator.generateRecordsWrite({
          author: alice,
        });
        const smallSize1Reply = await dwn.processMessage(alice.did, smallSize1.message, { dataStream: smallSize1.dataStream });
        expect(smallSize1Reply.status.code).to.equal(202);

        // add a large data size record
        const largeSize = await TestDataGenerator.generateRecordsWrite({
          author : alice,
          data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 1)
        });
        const largeSizeReply = await dwn.processMessage(alice.did, largeSize.message, { dataStream: largeSize.dataStream });
        expect(largeSizeReply.status.code).to.equal(202);

        // wait for message handler to process and check results
        await Time.minimalSleep();
        expect(smallMessages.length).to.equal(1);
        expect(smallMessages).to.have.members([ await Message.getCid(smallSize1.message) ]);

        // add another small record
        const smallSize2 = await TestDataGenerator.generateRecordsWrite({
          author: alice,
        });
        const smallSize2Reply = await dwn.processMessage(alice.did, smallSize2.message, { dataStream: smallSize2.dataStream });
        expect(smallSize2Reply.status.code).to.equal(202);

        // add another large record
        const largeSize2 = await TestDataGenerator.generateRecordsWrite({
          author : alice,
          data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 1)
        });
        const largeSize2Reply = await dwn.processMessage(alice.did, largeSize2.message, { dataStream: largeSize2.dataStream });
        expect(largeSize2Reply.status.code).to.equal(202);

        // wait for message handler to process and check results
        await Time.minimalSleep();
        expect(smallMessages.length).to.equal(2);
        expect(smallMessages).to.include.members([ await Message.getCid(smallSize2.message) ]);
      });

      it('does not emit events after subscription is closed', async () => {
        const alice = await DidKeyResolver.generate();

        // messageCids of events
        const messageCids:string[] = [];

        const handler = async (message: GenericMessage): Promise<void> => {
          const messageCid = await Message.getCid(message);
          messageCids.push(messageCid);
        };

        // subscribe to all events
        const eventsSubscription = await TestDataGenerator.generateEventsSubscribe({ author: alice });
        const eventsSubscriptionReply = await dwn.processMessage(alice.did, eventsSubscription.message, { subscriptionHandler: handler });
        expect(eventsSubscriptionReply.status.code).to.equal(200);

        expect(messageCids.length).to.equal(0); // no events exist yet

        const record1 = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const record1Reply = await dwn.processMessage(alice.did, record1.message, { dataStream: record1.dataStream });
        expect(record1Reply.status.code).to.equal(202);
        const record1MessageCid = await Message.getCid(record1.message);

        expect(messageCids.length).to.equal(1); // message exists
        expect(messageCids).to.eql([ record1MessageCid ]);

        // unsubscribe, this should be used as clean up.
        await eventsSubscriptionReply.subscription!.close();

        // write another message.
        const record2 = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const record2Reply = await dwn.processMessage(alice.did, record2.message, { dataStream: record2.dataStream });
        expect(record2Reply.status.code).to.equal(202);

        // sleep to make sure events have some time to emit.
        await Time.minimalSleep();

        expect(messageCids.length).to.equal(1); // same as before
        expect(messageCids).to.eql([ record1MessageCid ]);
      });
    });

    describe('records subscribe', () => {
      it('allows for anonymous subscriptions to published records', async () => {
        const alice = await DidKeyResolver.generate();

        // subscribe to this thread's events
        const messages:string[] = [];
        const subscriptionHandler = async (message:GenericMessage):Promise<void> => {
          messages.push(await Message.getCid(message));
        };

        const anonymousSubscription = await TestDataGenerator.generateRecordsSubscribe({
          anonymous : true,
          filter    : { schema: 'http://schema1' }
        });

        const threadSubscriptionReply = await dwn.processMessage(alice.did, anonymousSubscription.message, {
          subscriptionHandler
        });
        expect(threadSubscriptionReply.status.code).to.equal(200);
        expect(threadSubscriptionReply.subscription).to.exist;

        const write1 = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'http://schema1', published: true });
        const write1Reply = await dwn.processMessage(alice.did, write1.message, { dataStream: write1.dataStream });
        expect(write1Reply.status.code).to.equal(202);
        const write2 = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'http://schema1', published: true });
        const write2Reply = await dwn.processMessage(alice.did, write2.message, { dataStream: write2.dataStream });
        expect(write2Reply.status.code).to.equal(202);

        // await for handler to receive and process the message
        await Time.minimalSleep();

        expect(messages.length).to.equal(2);
        expect(messages).to.have.members([
          await Message.getCid(write1.message),
          await Message.getCid(write2.message),
        ]);
      });

      it('filters by protocol & parentId across multiple protocolPaths', async () => {
        // scenario: subscribe to multiple protocolPaths for a given protocol and parentId
        //    alice installs a protocol and creates a thread
        //    alice subscribes to update to that thread, it's participant as well as thread chats
        //    alice adds bob and carol as participants to the thread
        //    alice, bob, and carol all create messages
        //    alice deletes carol participant message
        //    alice checks that the correct messages were omitted

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


        // subscribe to this thread's events
        const messages:string[] = [];
        const subscriptionHandler = async (message:GenericMessage):Promise<void> => {
          messages.push(await Message.getCid(message));
        };

        const threadSubscription = await TestDataGenerator.generateRecordsSubscribe({
          author : alice,
          filter : { protocol: protocol, protocolPath: 'thread', parentId: thread.message.recordId }, // thread updates
        });
        const threadSubscriptionReply = await dwn.processMessage(alice.did, threadSubscription.message, {
          subscriptionHandler
        });
        expect(threadSubscriptionReply.status.code).to.equal(200);
        expect(threadSubscriptionReply.subscription).to.exist;

        const participantSubscription = await TestDataGenerator.generateRecordsSubscribe({
          author : alice,
          filter : { protocol: protocol, protocolPath: 'thread/participant', parentId: thread.message.recordId }, // participant updates
        });
        const participantSubscriptionReply = await dwn.processMessage(alice.did, participantSubscription.message, {
          subscriptionHandler
        });
        expect(participantSubscriptionReply.status.code).to.equal(200);
        expect(participantSubscriptionReply.subscription).to.exist;

        const chatSubscription = await TestDataGenerator.generateRecordsSubscribe({
          author : alice,
          filter : { protocol: protocol, protocolPath: 'thread/chat', parentId: thread.message.recordId } // chat updates
        });
        const chatSubscriptionReply = await dwn.processMessage(alice.did, chatSubscription.message, {
          subscriptionHandler
        });
        expect(chatSubscriptionReply.status.code).to.equal(200);
        expect(chatSubscriptionReply.subscription).to.exist;

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

        // add another thread as a control, will not show up in handled events
        const additionalThread = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : protocol,
          protocolPath : 'thread'
        });
        const additionalThreadReply = await dwn.processMessage(alice.did, additionalThread.message, { dataStream: additionalThread.dataStream });
        expect(additionalThreadReply.status.code).to.equal(202);

        // sleep to allow all messages to be processed by the handler message
        await Time.minimalSleep();

        expect(messages.length).to.equal(2);
        expect(messages).to.have.members([
          await Message.getCid(bobParticipant.message),
          await Message.getCid(carolParticipant.message),
        ]);

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

        // sleep in order to allow messages to process and check for the added messages
        await Time.minimalSleep();
        expect(messages.length).to.equal(5);
        expect(messages).to.include.members([
          await Message.getCid(message1.message),
          await Message.getCid(message2.message),
          await Message.getCid(message3.message),
        ]);

        // delete carol participant
        const deleteCarol = await TestDataGenerator.generateRecordsDelete({
          author   : alice,
          recordId : carolParticipant.message.recordId
        });
        const deleteCarolReply = await dwn.processMessage(alice.did, deleteCarol.message);
        expect(deleteCarolReply.status.code).to.equal(202);

        // sleep in order to allow messages to process and check for the delete message
        await Time.minimalSleep();
        expect(messages.length).to.equal(6);
        expect(messages).to.include.members([
          await Message.getCid(deleteCarol.message)
        ]);
      });
    });
  });
}