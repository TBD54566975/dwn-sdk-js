import type { DidResolver } from '@web5/dids';
import type { MessageEvent } from '../../src/types/subscriptions.js';
import type { RecordEvent } from '../../src/types/records-types.js';
import type {
  DataStore,
  EventLog,
  EventStream,
  MessageStore,
  ResumableTaskStore,
} from '../../src/index.js';

import freeForAll from '../vectors/protocol-definitions/free-for-all.json' assert { type: 'json' };
import threadProtocol from '../vectors/protocol-definitions/thread-role.json' assert { type: 'json' };

import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { TestTimingUtils } from '../utils/test-timing-utils.js';
import { DidKey, UniversalResolver } from '@web5/dids';
import { Dwn, DwnConstant, DwnInterfaceName, DwnMethodName, Message } from '../../src/index.js';

import { expect } from 'chai';

// NOTE: We use `TestTimingUtils.pollUntilSuccessOrTimeout` to poll for the expected results.
// In some cases, the EventStream is a coordinated pub/sub system and the messages/events are emitted over the network
// this means that the messages are not processed immediately and we need to wait for the messages to be processed
// before we can assert the results. The `pollUntilSuccessOrTimeout` function is a utility function that will poll

// It is also important to note that in some cases where we are testing a negative case (the message not arriving at the subscriber)
// we add an alternate subscription to await results within to give the EventStream ample time to process the message.
// In some of these cases the order in which messages are sent to be processed may matter, and they are noted as such.

export function testSubscriptionScenarios(): void {
  describe('subscriptions', () => {
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

    describe('events subscribe', () => {
      it('all events', async () => {
        // Scenario: Alice subscribes to all events and creates 3 messages.
        // Alice expects to receive all 3 messages.
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // create a handler that adds the messageCid of each message to an array.
        const messageCids: string[] = [];
        const handler = async (event: MessageEvent): Promise<void> => {
          const { message } = event;
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

        const protocol1 = await TestDataGenerator.generateProtocolsConfigure({ author: alice });
        const protocol1MessageCid = await Message.getCid(protocol1.message);
        const protocol1Reply = await dwn.processMessage(alice.did, protocol1.message);
        expect(protocol1Reply.status.code).to.equal(202);

        const deleteWrite1 = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: write1.message.recordId });
        const delete1MessageCid = await Message.getCid(deleteWrite1.message);
        const deleteWrite1Reply = await dwn.processMessage(alice.did, deleteWrite1.message);
        expect(deleteWrite1Reply.status.code).to.equal(202);

        // poll until the messages are received by the handler
        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          expect(messageCids.length).to.equal(3);
          expect(messageCids).to.eql([ write1MessageCid, protocol1MessageCid, delete1MessageCid ]);
        });

        // clean up the subscription handler
        await eventsSubscriptionReply.subscription?.close();
      });

      it('filters by interface type', async () => {
        // scenario:
        // alice subscribes to 2 different message interfaces Records and Protocols
        // alice creates (2) messages, RecordsWrite and ProtocolsConfigure
        // alice checks that each handler received the appropriate message
        // alice deletes the record
        // alice checks that the Records handler received the delete message

        const alice = await TestDataGenerator.generateDidKeyPersona();

        // subscribe to the Records interface
        const recordsInterfaceSubscription = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [{ interface: DwnInterfaceName.Records }]
        });
        const recordsMessageCids:string[] = [];
        const recordsSubscribeHandler = async (event: MessageEvent):Promise<void> => {
          const { message } = event;
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

        // subscribe to the Protocols interface
        const protocolsInterfaceSubscription = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [{ interface: DwnInterfaceName.Protocols }]
        });
        const protocolsMessageCids:string[] = [];
        const protocolsSubscribeHandler = async (event: MessageEvent):Promise<void> => {
          const { message } = event;
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

        // create one of each message types a RecordsWrite and a ProtocolsConfigure
        const record = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const recordReply = await dwn.processMessage(alice.did, record.message, { dataStream: record.dataStream });
        expect(recordReply.status.code).to.equal(202, 'RecordsWrite');

        const protocol = await TestDataGenerator.generateProtocolsConfigure({ author: alice });
        const protocolReply = await dwn.processMessage(alice.did, protocol.message);
        expect(protocolReply.status.code).to.equal(202, 'ProtocolConfigure');

        // Poll until the messages are received by the handler
        await TestTimingUtils.pollUntilSuccessOrTimeout(async () =>{
          // check record message
          expect(recordsMessageCids.length).to.equal(1);
          expect(recordsMessageCids).to.have.members([ await Message.getCid(record.message) ]);

          // check protocols message
          expect(protocolsMessageCids.length).to.equal(1);
          expect(protocolsMessageCids).to.have.members([ await Message.getCid(protocol.message) ]);
        });

        // delete the record
        const recordDelete = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: record.message.recordId });
        const recordDeleteReply = await dwn.processMessage(alice.did, recordDelete.message);
        expect(recordDeleteReply.status.code).to.equal(202, 'RecordsDelete');

        // poll until the delete message is received by the handler
        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          // check record messages to include the delete message
          expect(recordsMessageCids.length).to.equal(2);
          expect(recordsMessageCids).to.include.members([ await Message.getCid(recordDelete.message) ]);

          // check that the protocols message array does not include the delete message
          expect(protocolsMessageCids.length).to.equal(1); // unchanged
        });

        // clean up the subscriptions
        await recordsInterfaceSubscriptionReply.subscription?.close();
        await protocolsInterfaceSubscriptionReply.subscription?.close();
      });

      it('filters by method type', async () => {
        // scenario:
        // alice creates a subscription to an interface of Records and method of Write
        // alice creates a second subscription with an interface of Records and method of Delete
        // alice creates a RecordsWrite message to create a record
        // alice then updates that record with a subsequent RecordsWrite
        // alice checks that the recordsWrite array contains both messages
        // alice confirms that the recordsDelete array contains no messages
        // alice deletes the record with a RecordsDelete
        // alice writes a new record with a RecordsWrite
        // alice checks that the recordsWrite array includes the new record, but not the delete
        // alice checks the recordsDelete array includes the delete message

        const alice = await TestDataGenerator.generateDidKeyPersona();

        // subscribe to records write
        const recordsWriteSubscription = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [{ interface: DwnInterfaceName.Records, method: DwnMethodName.Write }]
        });
        const recordsWriteMessageCids:string[] = [];
        const recordsSubscribeHandler = async (event: MessageEvent):Promise<void> => {
          const { message } = event;
          const messageCid = await Message.getCid(message);
          recordsWriteMessageCids.push(messageCid);
        };

        const recordsWriteSubscriptionReply = await dwn.processMessage(
          alice.did,
          recordsWriteSubscription.message,
          { subscriptionHandler: recordsSubscribeHandler }
        );
        expect(recordsWriteSubscriptionReply.status.code).to.equal(200);
        expect(recordsWriteSubscriptionReply.subscription).to.exist;

        // subscribe to records delete
        const recordsDeleteSubscription = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [{ interface: DwnInterfaceName.Records, method: DwnMethodName.Delete }]
        });
        const recordsDeleteMessageCids:string[] = [];
        const recordsDeleteSubscribeHandler = async (event: MessageEvent):Promise<void> => {
          const { message } = event;
          const messageCid = await Message.getCid(message);
          recordsDeleteMessageCids.push(messageCid);
        };

        const recordsDeleteSubscriptionReply = await dwn.processMessage(
          alice.did,
          recordsDeleteSubscription.message,
          { subscriptionHandler: recordsDeleteSubscribeHandler }
        );
        expect(recordsDeleteSubscriptionReply.status.code).to.equal(200);
        expect(recordsDeleteSubscriptionReply.subscription).to.exist;

        // create and updates the record, this creates two RecordsWrite messages
        const record = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const recordReply = await dwn.processMessage(alice.did, record.message, { dataStream: record.dataStream });
        expect(recordReply.status.code).to.equal(202, 'RecordsWrite');
        const record1MessageCid = await Message.getCid(record.message);

        const recordUpdate = await TestDataGenerator.generateFromRecordsWrite({ author: alice, existingWrite: record.recordsWrite });
        const recordUpdateReply = await dwn.processMessage(alice.did, recordUpdate.message, { dataStream: recordUpdate.dataStream });
        expect(recordUpdateReply.status.code).to.equal(202, 'RecordsUpdate');
        const recordUpdateMessageCid = await Message.getCid(recordUpdate.message);

        // Poll until the messages are received by the handler
        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          // check the array for both the RecordsWrite messages
          expect(recordsWriteMessageCids.length).to.equal(2);
          expect(recordsWriteMessageCids).to.have.members([
            record1MessageCid,
            recordUpdateMessageCid,
          ]);
        });

        // confirm that the delete array is empty
        expect(recordsDeleteMessageCids.length).to.equal(0);

        // delete the record
        const recordDelete = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: record.message.recordId });
        const recordDeleteReply = await dwn.processMessage(alice.did, recordDelete.message);
        expect(recordDeleteReply.status.code).to.equal(202, 'RecordsDelete');
        const recordDeleteMessageCid = await Message.getCid(recordDelete.message);

        // write a second record
        const record2 = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const record2Reply = await dwn.processMessage(alice.did, record2.message, { dataStream: record2.dataStream });
        expect(record2Reply.status.code).to.equal(202, 'RecordsWrite');
        const record2MessageCid = await Message.getCid(record2.message);

        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          // ensure the new record is in the recordsWrite array, but not the delete
          expect(recordsWriteMessageCids.length).to.equal(3);
          expect(recordsWriteMessageCids).to.include.members([
            record1MessageCid,
            recordUpdateMessageCid,
            record2MessageCid,
          ]);
        });

        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          // ensure the delete message is in the recordsDelete array
          expect(recordsDeleteMessageCids.length).to.equal(1);
          expect(recordsDeleteMessageCids).to.include.members([
            recordDeleteMessageCid,
          ]);
        });
      });

      it('filters by a protocol across different message types', async () => {
        // scenario:
        //    alice creates (3) different message types all related to "proto1" (Configure, RecordsWrite, RecordsDelete)
        //    alice creates (3) different message types all related to "proto2" (Configure, RecordsWrite, RecordsDelete)
        //    when subscribing for a specific protocol, only Messages related to it should be received by the handler.

        const alice = await TestDataGenerator.generateDidKeyPersona();

        const proto1Messages:string[] = [];
        const proto1Handler = async (event: MessageEvent):Promise<void> => {
          const { message } = event;
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
        const proto2Handler = async (event: MessageEvent):Promise<void> => {
          const { message } = event;
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

        // configure proto1
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
        const proto1ConfMessageCid = await Message.getCid(protoConf1.message);

        // configure proto2
        const protoConf2 = await TestDataGenerator.generateProtocolsConfigure({
          author             : alice,
          protocolDefinition : { ...freeForAll, protocol: 'http://proto2' }
        });
        const proto2 = protoConf2.message.descriptor.definition.protocol;
        const protoConf2Response = await dwn.processMessage(alice.did, protoConf2.message);
        expect(protoConf2Response.status.code).equals(202);
        const proto2ConfMessageCid = await Message.getCid(protoConf2.message);

        // create a record for proto1
        const write1proto1 = await TestDataGenerator.generateRecordsWrite({ author: alice, protocol: proto1, ...postProperties });
        const write1Response = await dwn.processMessage(alice.did, write1proto1.message, { dataStream: write1proto1.dataStream });
        expect(write1Response.status.code).equals(202);
        const write1Proto1MessageCid = await Message.getCid(write1proto1.message);

        // create a record for proto2
        const write1proto2 = await TestDataGenerator.generateRecordsWrite({ author: alice, protocol: proto2, ...postProperties });
        const write1Proto2Response = await dwn.processMessage(alice.did, write1proto2.message, { dataStream: write1proto2.dataStream });
        expect(write1Proto2Response.status.code).equals(202);
        const write1Proto2MessageCid = await Message.getCid(write1proto2.message);

        // poll until the messages are received by the handlers
        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          // check for proto1 messages
          expect(proto1Messages.length).to.equal(2);
          expect(proto1Messages).to.have.members([ proto1ConfMessageCid, write1Proto1MessageCid ]);

          // check for proto2 messages
          expect(proto2Messages.length).to.equal(2);
          expect(proto2Messages).to.have.members([ proto2ConfMessageCid, write1Proto2MessageCid ]);
        });

        // delete proto1 message
        const deleteProto1Message = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: write1proto1.message.recordId });
        const deleteProto1MessageReply = await dwn.processMessage(alice.did, deleteProto1Message.message);
        expect(deleteProto1MessageReply.status.code).to.equal(202);

        // delete proto2 message
        const deleteProto2Message = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: write1proto2.message.recordId });
        const deleteProto2MessageReply = await dwn.processMessage(alice.did, deleteProto2Message.message);
        expect(deleteProto2MessageReply.status.code).to.equal(202);

        // poll until the messages are received by the handlers
        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          // check for the delete in proto1 messages
          expect(proto1Messages.length).to.equal(3);
          expect(proto1Messages).to.include.members([ await Message.getCid(deleteProto1Message.message) ]);

          // check for the delete in proto2 messages
          expect(proto2Messages.length).to.equal(3);
          expect(proto2Messages).to.include.members([ await Message.getCid(deleteProto2Message.message) ]);
        });
      });

      it('filters by protocol & contextId across multiple protocolPaths', async () => {
        // scenario: subscribe to multiple protocolPaths for a given protocol and parentId
        //    alice installs a protocol and creates a thread
        //    alice subscribes to with 3 filters: the thread itself, the thread/participants as well as thread thread/chats
        //    alice adds bob and carol as participants to the thread
        //    alice, bob, and carol all create messages
        //    alice deletes carol participant message
        //    alice checks that the correct messages were omitted

        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();
        const carol = await TestDataGenerator.generateDidKeyPersona();

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
        const subscriptionHandler = async (event: MessageEvent):Promise<void> => {
          const { message } = event;
          messages.push(await Message.getCid(message));
        };

        const threadSubscription = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [
            { protocol: protocol, protocolPath: 'thread', contextId: thread.message.contextId }, // thread updates
            { protocol: protocol, protocolPath: 'thread/participant', contextId: thread.message.contextId }, // participant updates
            { protocol: protocol, protocolPath: 'thread/chat', contextId: thread.message.contextId } // chat updates
          ],
        });
        const threadSubscriptionReply = await dwn.processMessage(alice.did, threadSubscription.message, {
          subscriptionHandler
        });
        expect(threadSubscriptionReply.status.code).to.equal(200);
        expect(threadSubscriptionReply.subscription).to.exist;

        // add another thread as a control, will not show up in handled events
        // NOTE: we purposely create this thread early in the test to ensure an external pub/sub system can have ample time to process the message
        const additionalThread = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : protocol,
          protocolPath : 'thread'
        });
        const additionalThreadReply = await dwn.processMessage(alice.did, additionalThread.message, { dataStream: additionalThread.dataStream });
        expect(additionalThreadReply.status.code).to.equal(202);

        // add bob as participant
        const bobParticipant = await TestDataGenerator.generateRecordsWrite({
          author          : alice,
          recipient       : bob.did,
          parentContextId : thread.message.contextId,
          protocol        : protocol,
          protocolPath    : 'thread/participant'
        });
        const bobParticipantReply = await dwn.processMessage(alice.did, bobParticipant.message, { dataStream: bobParticipant.dataStream });
        expect(bobParticipantReply.status.code).to.equal(202);

        // add carol as participant
        const carolParticipant = await TestDataGenerator.generateRecordsWrite({
          author          : alice,
          recipient       : carol.did,
          parentContextId : thread.message.contextId,
          protocol        : protocol,
          protocolPath    : 'thread/participant'
        });
        const carolParticipantReply = await dwn.processMessage(alice.did, carolParticipant.message, { dataStream: carolParticipant.dataStream });
        expect(carolParticipantReply.status.code).to.equal(202);

        // poll until we have the 2 participant messages
        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          // the messages array should have the two participant messages
          expect(messages.length).to.equal(2);
          expect(messages).to.have.members([
            await Message.getCid(bobParticipant.message),
            await Message.getCid(carolParticipant.message),
          ]);
        });

        // bob adds two chat messages
        const message1FromBob = await TestDataGenerator.generateRecordsWrite({
          author          : bob,
          recipient       : alice.did,
          parentContextId : thread.message.contextId,
          protocol        : protocol,
          protocolPath    : 'thread/chat',
          protocolRole    : 'thread/participant',
        });
        const message1FromBobReply = await dwn.processMessage(alice.did, message1FromBob.message, { dataStream: message1FromBob.dataStream });
        expect(message1FromBobReply.status.code).to.equal(202);

        const message2FromBob = await TestDataGenerator.generateRecordsWrite({
          author          : bob,
          recipient       : alice.did,
          parentContextId : thread.message.contextId,
          protocol        : protocol,
          protocolPath    : 'thread/chat',
          protocolRole    : 'thread/participant',
        });
        const message2FromBobReply = await dwn.processMessage(alice.did, message2FromBob.message, { dataStream: message2FromBob.dataStream });
        expect(message2FromBobReply.status.code).to.equal(202);

        const messageFromCarol = await TestDataGenerator.generateRecordsWrite({
          author          : carol,
          recipient       : alice.did,
          parentContextId : thread.message.contextId,
          protocol        : protocol,
          protocolPath    : 'thread/chat',
          protocolRole    : 'thread/participant',
        });
        const messageFromCarolReply = await dwn.processMessage(alice.did, messageFromCarol.message, { dataStream: messageFromCarol.dataStream });
        expect(messageFromCarolReply.status.code).to.equal(202);

        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          // should have the 3 chat messages
          expect(messages.length).to.equal(5);
          expect(messages).to.include.members([
            await Message.getCid(message1FromBob.message),
            await Message.getCid(message2FromBob.message),
            await Message.getCid(messageFromCarol.message),
          ]);
        });

        // delete carol participant
        const deleteCarol = await TestDataGenerator.generateRecordsDelete({
          author   : alice,
          recordId : carolParticipant.message.recordId
        });
        const deleteCarolReply = await dwn.processMessage(alice.did, deleteCarol.message);
        expect(deleteCarolReply.status.code).to.equal(202);

        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          // should have the delete of carol as a participant
          expect(messages.length).to.equal(6);
          expect(messages).to.include.members([
            await Message.getCid(deleteCarol.message)
          ]);

          // although we know the control thread is not in the messages array due to the counts
          // we explicitly check that it is not in the array as a defensive measure
          // NOTE: we purposely check down here to give the message ample time to be processed
          expect(messages).to.not.include(await Message.getCid(additionalThread.message));
        });
      });

      it('filters by schema', async () => {
        //SCENARIO:
        //  alice creates 2 subscriptions, one for schema1 and one for schema2
        //  alice creates a record each for schema1 and schema2
        //  alice checks that the appropriate messages were received by their respective handlers
        //  alice updates the record for schema1
        //  alice deletes the record for schema2
        //  alice checks that the appropriate messages were received by their respective handlers

        const alice = await TestDataGenerator.generateDidKeyPersona();

        // we will add messageCids to these arrays as they are received by their handler to check against later
        const schema1Messages:string[] = [];
        const schema2Messages:string[] = [];

        // we add a handler to the subscription and add the messageCid to the appropriate array
        const schema1Handler = async (event: MessageEvent):Promise<void> => {
          const { message } = event;
          const messageCid = await Message.getCid(message);
          schema1Messages.push(messageCid);
        };

        // subscribe to schema1 messages
        const schema1Subscription = await TestDataGenerator.generateEventsSubscribe({ author: alice, filters: [{ schema: 'http://schema1' }] });
        const schema1SubscriptionReply = await dwn.processMessage(alice.did, schema1Subscription.message, { subscriptionHandler: schema1Handler });
        expect(schema1SubscriptionReply.status.code).to.equal(200);
        expect(schema1SubscriptionReply.subscription?.id).to.equal(await Message.getCid(schema1Subscription.message));

        // we add a handler to the subscription and add the messageCid to the appropriate array
        const schema2Handler = async (event: MessageEvent):Promise<void> => {
          const { message } = event;
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

        // poll until the messages are received by the handlers
        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          // schema1 messages from handler has the new message representing the write.
          expect(schema1Messages.length).to.equal(1, 'schema1');
          expect(schema1Messages).to.include(await Message.getCid(write1schema1.message));

          // schema2 messages from handler has the new message representing the write.
          expect(schema2Messages.length).to.equal(1, 'schema2');
          expect(schema2Messages).to.include(await Message.getCid(write1schema2.message));
        });

        // create update the record for schema1
        const update1schema1 = await TestDataGenerator.generateFromRecordsWrite({ author: alice, existingWrite: write1schema1.recordsWrite });
        const update1Response = await dwn.processMessage(alice.did, update1schema1.message, { dataStream: update1schema1.dataStream });
        expect(update1Response.status.code).equals(202);

        // delete the record for schema2
        const deleteschema2 = await TestDataGenerator.generateRecordsDelete({ author: alice, recordId: write1schema2.message.recordId });
        const deleteSchema2Response = await dwn.processMessage(alice.did, deleteschema2.message);
        expect(deleteSchema2Response.status.code).equals(202);

        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          // schema1 messages from handler has the new message representing the update.
          expect(schema1Messages.length).to.equal(2, 'schema1');
          expect(schema1Messages).to.include(await Message.getCid(update1schema1.message));

          // schema2 messages from handler has the new message representing the delete.
          expect(schema2Messages.length).to.equal(2, 'schema2');
          expect(schema2Messages).to.include(await Message.getCid(deleteschema2.message));
        });
      });

      it('filters by recordId', async () => {
        // alice creates a 2 record and don't process them yet.
        // alice creates a subscription for only one of the recordIds
        // alice now process both records
        // alice updates the record that was subscribed to
        // check that the subscription handler has both the write and update messages
        // delete both records
        // check that the subscription handler has the delete message for the subscribed recordId

        const alice = await TestDataGenerator.generateDidKeyPersona();

        // create 2 records
        const write1 = await TestDataGenerator.generateRecordsWrite({
          author : alice,
          schema : 'schema1'
        });

        const write2 = await TestDataGenerator.generateRecordsWrite({
          author : alice,
          schema : 'schema1'
        });

        // create a subscription and capture the messages associated with the recordId for write1
        const messages: string[] = [];
        const subscriptionHandler = async (event: MessageEvent):Promise<void> => {
          const { message } = event;
          messages.push(await Message.getCid(message));
        };

        const recordIdSubscribe = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [{ recordId: write1.message.recordId }]
        });
        const recordIdSubscribeReply = await dwn.processMessage(alice.did, recordIdSubscribe.message, {
          subscriptionHandler
        });
        expect(recordIdSubscribeReply.status.code).to.equal(200);

        // process both records
        const write1Reply = await dwn.processMessage(alice.did, write1.message, { dataStream: write1.dataStream });
        expect(write1Reply.status.code).to.equal(202);
        const write2Reply = await dwn.processMessage(alice.did, write2.message, { dataStream: write2.dataStream });
        expect(write2Reply.status.code).to.equal(202);

        // update the subscribed record
        const update = await TestDataGenerator.generateFromRecordsWrite({
          author        : alice,
          existingWrite : write1.recordsWrite,
        });
        const updateReply = await dwn.processMessage(alice.did, update.message, { dataStream: update.dataStream });
        expect(updateReply.status.code).to.equal(202);

        // check that the subscription handler has both the write and update messages
        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          expect(messages.length).to.equal(2);
          expect(messages).to.have.members([
            await Message.getCid(write1.message),
            await Message.getCid(update.message)
          ]);
        });

        // delete both records
        const deleteWrite1 = await TestDataGenerator.generateRecordsDelete({
          author   : alice,
          recordId : write1.message.recordId,
        });
        const deleteWrite1Reply = await dwn.processMessage(alice.did, deleteWrite1.message);
        expect(deleteWrite1Reply.status.code).to.equal(202);

        const deleteWrite2 = await TestDataGenerator.generateRecordsDelete({
          author   : alice,
          recordId : write2.message.recordId,
        });
        const deleteWrite2Reply = await dwn.processMessage(alice.did, deleteWrite2.message);
        expect(deleteWrite2Reply.status.code).to.equal(202);

        // check that the subscription handler has the delete message for the subscribed recordId
        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          expect(messages.length).to.equal(3); // write1, update, delete
          expect(messages).to.include(await Message.getCid(deleteWrite1.message));

          // confirm that messages for write2 is not in the messages array
          expect(messages).to.not.include(await Message.getCid(write2.message));
          expect(messages).to.not.include(await Message.getCid(deleteWrite2.message));
        });
      });

      it('filters by recipient', async () => {
        // scenario:
        // alice subscribes to messages with herself as the recipient
        // bob and carol sends a messages to alice
        // alice sends a message to bob
        // bob and carol send a messages to each other
        // alice checks that the receivedMessages array only contains the messages from bob and carol to alice

        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();
        const carol = await TestDataGenerator.generateDidKeyPersona();

        // alice installs a freeForAll protocol
        const protocolConfigure = await TestDataGenerator.generateProtocolsConfigure({
          author             : alice,
          protocolDefinition : { ...freeForAll }
        });
        const protocolConfigureReply = await dwn.processMessage(alice.did, protocolConfigure.message);
        expect(protocolConfigureReply.status.code).to.equal(202);
        const protocol = protocolConfigure.message.descriptor.definition.protocol;

        // create a control handler to capture ALL messages in the protocol
        // this will be used to confirm that the messages are not received by alice
        // we do this to test that messages are not received by one handler but have had enough time to be processed
        // in some external pub/sub system it may take time for the message to be processed
        const allMessages:string[] = [];
        const allHandler = async (event: MessageEvent): Promise<void> => {
          const { message } = event;
          allMessages.push(await Message.getCid(message));
        };
        const allSubscription = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [{ protocol: protocol }]
        });
        const allSubscriptionReply = await dwn.processMessage(alice.did, allSubscription.message, { subscriptionHandler: allHandler });
        expect(allSubscriptionReply.status.code).to.equal(200);

        // alice subscribes to messages with herself as the recipient on her own DWN
        const aliceMessages:string[] = [];
        const handler = async (event: MessageEvent): Promise<void> => {
          const { message } = event;
          const messageCid = await Message.getCid(message);
          aliceMessages.push(messageCid);
        };

        const recipientSubscription = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [{ recipient: alice.did }]
        });
        const authorQueryReply = await dwn.processMessage(alice.did, recipientSubscription.message, { subscriptionHandler: handler });
        expect(authorQueryReply.status.code).to.equal(200);


        // common properties for the post messages
        const postProperties = {
          protocol     : protocol,
          protocolPath : 'post',
          schema       : freeForAll.types.post.schema,
          dataFormat   : freeForAll.types.post.dataFormats[0],
        };

        // bob sends a message to alice
        const messageFromBobToAlice = await TestDataGenerator.generateRecordsWrite({
          ...postProperties,
          author    : bob,
          recipient : alice.did,
        });
        const messageFromBobToAliceReply =
          await dwn.processMessage(alice.did, messageFromBobToAlice.message, { dataStream: messageFromBobToAlice.dataStream });
        expect(messageFromBobToAliceReply.status.code).to.equal(202);

        // carol sends a message to alice
        const messageFromCarolToAlice = await TestDataGenerator.generateRecordsWrite({
          ...postProperties,
          author    : carol,
          recipient : alice.did,
        });
        const messageFromCarolToAliceReply =
          await dwn.processMessage(alice.did, messageFromCarolToAlice.message, { dataStream: messageFromCarolToAlice.dataStream });
        expect(messageFromCarolToAliceReply.status.code).to.equal(202);

        // alice sends a message to bob, this will not show up in the aliceMessages array, but will in the allMessages array
        const messageFromAliceToBob = await TestDataGenerator.generateRecordsWrite({
          ...postProperties,
          author    : alice,
          recipient : bob.did,
        });
        const messageFromAliceToBobReply =
          await dwn.processMessage(alice.did, messageFromAliceToBob.message, { dataStream: messageFromAliceToBob.dataStream });
        expect(messageFromAliceToBobReply.status.code).to.equal(202);

        // bob sends a message to carol, this will not show up in the aliceMessages array, but will in the allMessages array
        const messageFromBobToCarol = await TestDataGenerator.generateRecordsWrite({
          ...postProperties,
          author    : bob,
          recipient : carol.did,
        });
        const messageFromBobToCarolReply =
          await dwn.processMessage(alice.did, messageFromBobToCarol.message, { dataStream: messageFromBobToCarol.dataStream });
        expect(messageFromBobToCarolReply.status.code).to.equal(202);

        // poll until the messages are received by the handlers
        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          // check that the aliceMessages array only contains the messages from bob and carol to alice
          expect(aliceMessages.length).to.equal(2);
          expect(aliceMessages).to.have.members([
            await Message.getCid(messageFromBobToAlice.message),
            await Message.getCid(messageFromCarolToAlice.message)
          ]);

          // check that the allMessages array contains all the messages
          expect(allMessages.length).to.equal(4);
          expect(allMessages).to.have.members([
            await Message.getCid(messageFromBobToAlice.message),
            await Message.getCid(messageFromCarolToAlice.message),
            await Message.getCid(messageFromAliceToBob.message),
            await Message.getCid(messageFromBobToCarol.message)
          ]);
        });
      });

      it('filters by dataFormat', async () => {
        // Scenario: Alice subscribes events relating to `image/jpeg` after which a number of record messages of various data formats are processed
        // 1. Alice subscribes for `image/jpeg` records
        // 2. Alice creates 3 files, one of them `image/jpeg`
        // 3. Alice receives the one `image/jpeg` message
        // 4. Alice adds another image
        // 5. Alice receives the other `image/jpeg` message

        const alice = await TestDataGenerator.generateDidKeyPersona();

        const imageMessages: string[] = [];
        const imageHandler = async (event: MessageEvent):Promise<void> => {
          const { message } = event;
          imageMessages.push(await Message.getCid(message));
        };

        // alice subscribes to image/jpeg changes
        const imageSubscription = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [{ dataFormat: 'image/jpeg' }]
        });
        const imageSubscriptionReply = await dwn.processMessage(alice.did, imageSubscription.message, {
          subscriptionHandler: imageHandler
        });
        expect(imageSubscriptionReply.status.code).to.equal(200);

        // NOTE: we purposely create the non-matching files ahead of the matching files.
        // this helps ensure that the non-matching files have had ample time to be processed by an external pub/sub system

        // write an `application/text` file (will not match)
        const textFile = await TestDataGenerator.generateRecordsWrite({
          author     : alice,
          dataFormat : 'application/text'
        });
        const textFileReply = await dwn.processMessage(alice.did, textFile.message, { dataStream: textFile.dataStream });
        expect(textFileReply.status.code).to.equal(202);

        // write an `application/json` file (will not match)
        const jsonData = await TestDataGenerator.generateRecordsWrite({
          author     : alice,
          dataFormat : 'application/json'
        });
        const jsonDataReply = await dwn.processMessage(alice.did, jsonData.message, { dataStream: jsonData.dataStream });
        expect(jsonDataReply.status.code).to.equal(202);

        // write an `image/jpeg` file (will match)
        const imageData = await TestDataGenerator.generateRecordsWrite({
          author     : alice,
          dataFormat : 'image/jpeg'
        });
        const imageDataReply = await dwn.processMessage(alice.did, imageData.message, { dataStream: imageData.dataStream });
        expect(imageDataReply.status.code).to.equal(202);

        // poll until the image message is received by the handlers
        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          expect(imageMessages.length).to.equal(1);
          expect(imageMessages).to.have.members([ await Message.getCid(imageData.message) ]);
        });

        // add another `image/jpeg` file, this should also be received by the handler
        const imageData2 = await TestDataGenerator.generateRecordsWrite({
          author     : alice,
          dataFormat : 'image/jpeg'
        });
        const imageData2Reply = await dwn.processMessage(alice.did, imageData2.message, { dataStream: imageData2.dataStream });
        expect(imageData2Reply.status.code).to.equal(202);

        // poll until the image message is received by the handlers
        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          expect(imageMessages.length).to.equal(2);
          expect(imageMessages).to.include.members([ await Message.getCid(imageData2.message) ]);
        });
      });;

      it('filters by dataSize', async () => {
        // scenario:
        //    alice subscribes to messages with data size under a threshold
        //    alice also subscribes to messages with data size over a threshold
        //    alice inserts both small and large data messages
        //    alice checks that the messages were received by their respective handlers

        const alice = await TestDataGenerator.generateDidKeyPersona();

        // subscribe to small data size messages
        const smallMessages: string[] = [];
        const subscriptionHandler = async (event: MessageEvent):Promise<void> => {
          const { message } = event;
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

        // subscribe to large data size messages
        const largeMessages: string[] = [];
        const largeSubscriptionHandler = async (event: MessageEvent):Promise<void> => {
          const { message } = event;
          largeMessages.push(await Message.getCid(message));
        };
        const largeMessageSubscription = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [{ dataSize: { gt: DwnConstant.maxDataSizeAllowedToBeEncoded } }]
        });
        const largeMessageSubscriptionReply = await dwn.processMessage(alice.did, largeMessageSubscription.message, {
          subscriptionHandler: largeSubscriptionHandler,
        });
        expect(largeMessageSubscriptionReply.status.code).to.equal(200);

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

        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          // smallMessages array should only contain the small data size record
          expect(smallMessages.length).to.equal(1);
          expect(smallMessages).to.have.members([ await Message.getCid(smallSize1.message) ]);

          // largeMessages array should only contain the large data size record
          expect(largeMessages.length).to.equal(1);
          expect(largeMessages).to.have.members([ await Message.getCid(largeSize.message) ]);
        });

        // add another large record
        const largeSize2 = await TestDataGenerator.generateRecordsWrite({
          author : alice,
          data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 1)
        });
        const largeSize2Reply = await dwn.processMessage(alice.did, largeSize2.message, { dataStream: largeSize2.dataStream });
        expect(largeSize2Reply.status.code).to.equal(202);

        // add another small record
        const smallSize2 = await TestDataGenerator.generateRecordsWrite({
          author: alice,
        });
        const smallSize2Reply = await dwn.processMessage(alice.did, smallSize2.message, { dataStream: smallSize2.dataStream });
        expect(smallSize2Reply.status.code).to.equal(202);

        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          // smallMessages array should only contain the two small data size records
          expect(smallMessages.length).to.equal(2);
          expect(smallMessages).to.include.members([
            await Message.getCid(smallSize1.message),
            await Message.getCid(smallSize2.message)
          ]);

          // largeMessages array should only contain the two large data size records
          expect(largeMessages.length).to.equal(2);
          expect(largeMessages).to.include.members([
            await Message.getCid(largeSize.message),
            await Message.getCid(largeSize2.message)
          ]);
        });
      });

      it('does not emit events after subscription is closed', async () => {
        // scenario: create two subscriptions.
        // write a message, check that both subscriptions receive the message.
        // close one subscription, write two more messages, check that only the open subscription receives the messages.
        // we purposely leave one subscription open to ensure that the messages are being processed by an external pub/sub system

        const alice = await TestDataGenerator.generateDidKeyPersona();

        // messageCids of subscription 1 events
        const sub1MessageCids:string[] = [];
        const handler1 = async (event: MessageEvent): Promise<void> => {
          const { message } = event;
          const messageCid = await Message.getCid(message);
          sub1MessageCids.push(messageCid);
        };

        // messageCids of subscription 2 events
        const sub2MessageCids:string[] = [];
        const handler2 = async (event: MessageEvent): Promise<void> => {
          const { message } = event;
          const messageCid = await Message.getCid(message);
          sub2MessageCids.push(messageCid);
        };


        // subscribe to all events
        const eventsSubscription1 = await TestDataGenerator.generateEventsSubscribe({ author: alice });
        const eventsSubscription1Reply = await dwn.processMessage(alice.did, eventsSubscription1.message, { subscriptionHandler: handler1 });
        expect(eventsSubscription1Reply.status.code).to.equal(200);

        const eventsSubscription2 = await TestDataGenerator.generateEventsSubscribe({ author: alice });
        const eventsSubscription2Reply = await dwn.processMessage(alice.did, eventsSubscription2.message, { subscriptionHandler: handler2 });
        expect(eventsSubscription2Reply.status.code).to.equal(200);

        // no events exist yet
        expect(sub1MessageCids.length).to.equal(0);
        expect(sub2MessageCids.length).to.equal(0);

        // write a record
        const record1 = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const record1Reply = await dwn.processMessage(alice.did, record1.message, { dataStream: record1.dataStream });
        expect(record1Reply.status.code).to.equal(202);
        const record1MessageCid = await Message.getCid(record1.message);

        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          // both subscriptions should have received the message
          expect(sub1MessageCids.length).to.equal(1); // message exists
          expect(sub1MessageCids).to.eql([ record1MessageCid ]);

          expect(sub2MessageCids.length).to.equal(1); // message exists
          expect(sub2MessageCids).to.eql([ record1MessageCid ]);
        });

        // unsubscribe from subscription 2
        await eventsSubscription2Reply.subscription!.close();

        // write two more message.
        const record2 = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const record2Reply = await dwn.processMessage(alice.did, record2.message, { dataStream: record2.dataStream });
        expect(record2Reply.status.code).to.equal(202);
        const record2MessageCid = await Message.getCid(record2.message);

        const record3 = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const record3Reply = await dwn.processMessage(alice.did, record3.message, { dataStream: record3.dataStream });
        expect(record3Reply.status.code).to.equal(202);
        const record3MessageCid = await Message.getCid(record3.message);

        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          expect(sub1MessageCids.length).to.equal(3); // all three messages exist
          expect(sub1MessageCids).to.eql([
            record1MessageCid,
            record2MessageCid,
            record3MessageCid
          ]);

          expect(sub2MessageCids.length).to.equal(1); // only the first message exists
          expect(sub2MessageCids).to.eql([ record1MessageCid ]);
        });
      });
    });

    describe('records subscribe', () => {
      it('allows for anonymous subscriptions to published records', async () => {
        // scenario:
        // a user creates an anonymous subscription filtered to a schema to alice's DWN
        // alice writes two records, one not published and one published
        // alice checks that the anonymous subscription handler only received the published record

        // NOTE we create a control subscription to capture all messages
        // this is to ensure that the messages are not received by the anonymous subscription handler, but have had ample time to be processed

        const alice = await TestDataGenerator.generateDidKeyPersona();

        // create a control handler to capture ALL messages in the protocol with alice as the author
        const allMessages:string[] = [];
        const allHandler = async (event: MessageEvent): Promise<void> => {
          const { message } = event;
          allMessages.push(await Message.getCid(message));
        };
        const allSubscription = await TestDataGenerator.generateEventsSubscribe({
          author  : alice,
          filters : [{ schema: 'http://schema1' }]
        });
        const allSubscriptionReply = await dwn.processMessage(alice.did, allSubscription.message, { subscriptionHandler: allHandler });
        expect(allSubscriptionReply.status.code).to.equal(200);


        // we create an anonymous subscription to capture only published messages
        const publishedMessages:string[] = [];
        const anonymousSubscriptionHandler = async (event: RecordEvent):Promise<void> => {
          const { message } = event;
          publishedMessages.push(await Message.getCid(message));
        };
        const anonymousSubscription = await TestDataGenerator.generateRecordsSubscribe({
          anonymous : true,
          filter    : { schema: 'http://schema1' }
        });
        const anonymousSubscriptionReply = await dwn.processMessage(alice.did, anonymousSubscription.message, {
          subscriptionHandler: anonymousSubscriptionHandler
        });
        expect(anonymousSubscriptionReply.status.code).to.equal(200);
        expect(anonymousSubscriptionReply.subscription).to.exist;


        // we create a non published record, this will only show up in the control subscription
        const writeNotPublished = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'http://schema1' });
        const writeNotPublishedReply = await dwn.processMessage(alice.did, writeNotPublished.message, { dataStream: writeNotPublished.dataStream });
        expect(writeNotPublishedReply.status.code).to.equal(202);

        // we create a published record, this will show up in both the control and anonymous subscription
        const write1 = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'http://schema1', published: true });
        const write1Reply = await dwn.processMessage(alice.did, write1.message, { dataStream: write1.dataStream });
        expect(write1Reply.status.code).to.equal(202);

        // we create another published record, this will show up in both the control and anonymous subscription
        const write2 = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'http://schema1', published: true });
        const write2Reply = await dwn.processMessage(alice.did, write2.message, { dataStream: write2.dataStream });
        expect(write2Reply.status.code).to.equal(202);

        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          // publishedMessages array should only contain the two published messages
          expect(publishedMessages.length).to.equal(2);
          expect(publishedMessages).to.have.members([
            await Message.getCid(write1.message),
            await Message.getCid(write2.message),
          ]);

          // allMessages array should contain all three messages
          expect(allMessages.length).to.equal(3);
          expect(allMessages).to.have.members([
            await Message.getCid(writeNotPublished.message),
            await Message.getCid(write1.message),
            await Message.getCid(write2.message),
          ]);
        });
      });

      it('allows authorized subscriptions to records intended for a recipient', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();
        const carol = await TestDataGenerator.generateDidKeyPersona();

        // bob subscribes to any messages he's authorized to see
        const bobMessages:string[] = [];
        const bobSubscribeHandler = async (event: MessageEvent):Promise<void> => {
          const { message } = event;
          bobMessages.push(await Message.getCid(message));
        };

        const bobSubscribe = await TestDataGenerator.generateRecordsSubscribe({
          author : bob,
          filter : { schema: 'http://schema1' }
        });

        const bobSubscribeReply = await dwn.processMessage(alice.did, bobSubscribe.message, {
          subscriptionHandler: bobSubscribeHandler
        });
        expect(bobSubscribeReply.status.code).to.equal(200);
        expect(bobSubscribeReply.subscription).to.exist;

        // carol subscribes to any messages she's the recipient of.
        const carolMessages:string[] = [];
        const carolSubscribeHandler = async (event: RecordEvent):Promise<void> => {
          const { message } = event;
          carolMessages.push(await Message.getCid(message));
        };

        const carolSubscribe = await TestDataGenerator.generateRecordsSubscribe({
          author : carol,
          filter : { schema: 'http://schema1', recipient: carol.did }
        });

        const carolSubscribeReply = await dwn.processMessage(alice.did, carolSubscribe.message, {
          subscriptionHandler: carolSubscribeHandler
        });
        expect(carolSubscribeReply.status.code).to.equal(200);
        expect(carolSubscribeReply.subscription).to.exist;

        // write two messages for bob
        const write1 = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'http://schema1', recipient: bob.did });
        const write1Reply = await dwn.processMessage(alice.did, write1.message, { dataStream: write1.dataStream });
        expect(write1Reply.status.code).to.equal(202);

        const write2 = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'http://schema1', recipient: bob.did });
        const write2Reply = await dwn.processMessage(alice.did, write2.message, { dataStream: write2.dataStream });
        expect(write2Reply.status.code).to.equal(202);

        // write one message for carol
        const writeForCarol = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'http://schema1', recipient: carol.did });
        const writeForCarolReply = await dwn.processMessage(alice.did, writeForCarol.message, { dataStream: writeForCarol.dataStream });
        expect(writeForCarolReply.status.code).to.equal(202);

        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          // bob should have received the two messages intended for him
          expect(bobMessages.length).to.equal(2);
          expect(bobMessages).to.have.members([
            await Message.getCid(write1.message),
            await Message.getCid(write2.message),
          ]);

          // carol should have received the message intended for her
          expect(carolMessages.length).to.equal(1);
          expect(carolMessages).to.have.members([
            await Message.getCid(writeForCarol.message),
          ]);
        });
      });

      it('filters by protocol & contextId across multiple protocolPaths', async () => {
        // scenario: subscribe to multiple protocolPaths for a given protocol and contextId
        //    alice installs a protocol and creates a thread
        //    alice subscribes to update to that thread, it's participant as well as thread chats
        //    alice adds bob and carol as participants to the thread
        //    alice, bob, and carol all create messages
        //    alice deletes carol participant message
        //    alice checks that the correct messages were omitted

        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();
        const carol = await TestDataGenerator.generateDidKeyPersona();

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
        const initialWrites: string[] = [];
        const subscriptionHandler = async (event :MessageEvent):Promise<void> => {
          const { message, initialWrite } = event;
          if (initialWrite !== undefined) {
            initialWrites.push(await Message.getCid(initialWrite));
          }
          messages.push(await Message.getCid(message));
        };

        const threadSubscription = await TestDataGenerator.generateRecordsSubscribe({
          author : alice,
          filter : { protocol: protocol, protocolPath: 'thread', contextId: thread.message.contextId }, // thread updates
        });
        const threadSubscriptionReply = await dwn.processMessage(alice.did, threadSubscription.message, {
          subscriptionHandler
        });
        expect(threadSubscriptionReply.status.code).to.equal(200);
        expect(threadSubscriptionReply.subscription).to.exist;

        const participantSubscription = await TestDataGenerator.generateRecordsSubscribe({
          author : alice,
          filter : { protocol: protocol, protocolPath: 'thread/participant', contextId: thread.message.contextId }, // participant updates
        });
        const participantSubscriptionReply = await dwn.processMessage(alice.did, participantSubscription.message, {
          subscriptionHandler
        });
        expect(participantSubscriptionReply.status.code).to.equal(200);
        expect(participantSubscriptionReply.subscription).to.exist;

        const chatSubscription = await TestDataGenerator.generateRecordsSubscribe({
          author : alice,
          filter : { protocol: protocol, protocolPath: 'thread/chat', contextId: thread.message.contextId } // chat updates
        });
        const chatSubscriptionReply = await dwn.processMessage(alice.did, chatSubscription.message, {
          subscriptionHandler
        });
        expect(chatSubscriptionReply.status.code).to.equal(200);
        expect(chatSubscriptionReply.subscription).to.exist;

        // add bob as participant
        const bobParticipant = await TestDataGenerator.generateRecordsWrite({
          author          : alice,
          recipient       : bob.did,
          parentContextId : thread.message.contextId,
          protocol        : protocol,
          protocolPath    : 'thread/participant'
        });
        const bobParticipantReply = await dwn.processMessage(alice.did, bobParticipant.message, { dataStream: bobParticipant.dataStream });
        expect(bobParticipantReply.status.code).to.equal(202);

        // add carol as participant
        const carolParticipant = await TestDataGenerator.generateRecordsWrite({
          author          : alice,
          recipient       : carol.did,
          parentContextId : thread.message.contextId,
          protocol        : protocol,
          protocolPath    : 'thread/participant'
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

        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          expect(messages.length).to.equal(2);
          expect(messages).to.have.members([
            await Message.getCid(bobParticipant.message),
            await Message.getCid(carolParticipant.message),
          ]);
        });

        // add a message to protocol1
        const message1 = await TestDataGenerator.generateRecordsWrite({
          author          : bob,
          recipient       : alice.did,
          parentContextId : thread.message.contextId,
          protocol        : protocol,
          protocolPath    : 'thread/chat',
          protocolRole    : 'thread/participant',
        });
        const message1Reply = await dwn.processMessage(alice.did, message1.message, { dataStream: message1.dataStream });
        expect(message1Reply.status.code).to.equal(202);

        const message2 = await TestDataGenerator.generateRecordsWrite({
          author          : bob,
          recipient       : alice.did,
          parentContextId : thread.message.contextId,
          protocol        : protocol,
          protocolPath    : 'thread/chat',
          protocolRole    : 'thread/participant',
        });
        const message2Reply = await dwn.processMessage(alice.did, message2.message, { dataStream: message2.dataStream });
        expect(message2Reply.status.code).to.equal(202);

        const message3 = await TestDataGenerator.generateRecordsWrite({
          author          : carol,
          recipient       : alice.did,
          parentContextId : thread.message.contextId,
          protocol        : protocol,
          protocolPath    : 'thread/chat',
          protocolRole    : 'thread/participant',
        });
        const message3Reply = await dwn.processMessage(alice.did, message3.message, { dataStream: message3.dataStream });
        expect(message3Reply.status.code).to.equal(202);

        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          expect(messages.length).to.equal(5);
          expect(messages).to.include.members([
            await Message.getCid(message1.message),
            await Message.getCid(message2.message),
            await Message.getCid(message3.message),
          ]);
        });

        // delete carol participant
        const deleteCarol = await TestDataGenerator.generateRecordsDelete({
          author   : alice,
          recordId : carolParticipant.message.recordId
        });
        const deleteCarolReply = await dwn.processMessage(alice.did, deleteCarol.message);
        expect(deleteCarolReply.status.code).to.equal(202);

        await TestTimingUtils.pollUntilSuccessOrTimeout(async () => {
          expect(messages.length).to.equal(6);
          expect(messages).to.include.members([
            await Message.getCid(deleteCarol.message)
          ]);

          // check the initial write was included with the delete
          expect(initialWrites).to.include.members([
            await Message.getCid(carolParticipant.message)
          ]);
        });
      });
    });
  });
}