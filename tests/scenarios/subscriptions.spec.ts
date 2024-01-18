import type {
  DataStore,
  EventLog,
  EventStream,
  GenericMessage,
  MessageStore,
} from '../../src/index.js';

import freeForAll from '../vectors/protocol-definitions/free-for-all.json' assert { type: 'json' };

import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { Time } from '../../src/utils/time.js';
import { DidKeyResolver, DidResolver, Dwn, Message } from '../../src/index.js';

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

      it('filters by protocol', async () => {
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

        // create a proto1
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

        // we will add messageCids to these arrays as they are received by their handler to check against later
        const proto1Messages:string[] = [];
        const proto2Messages:string[] = [];

        // we add a handler to the subscription and add the messageCid to the appropriate array
        const proto1Handler = async (message:GenericMessage):Promise<void> => {
          const messageCid = await Message.getCid(message);
          proto1Messages.push(messageCid);
        };

        // subscribe to proto1 messages
        const proto1Subscription = await TestDataGenerator.generateEventsSubscribe({ author: alice, filters: [{ protocol: proto1 }] });
        const proto1SubscriptionReply = await dwn.processMessage(alice.did, proto1Subscription.message, { subscriptionHandler: proto1Handler });
        expect(proto1SubscriptionReply.status.code).to.equal(200);
        expect(proto1SubscriptionReply.subscription?.id).to.equal(await Message.getCid(proto1Subscription.message));

        // we add a handler to the subscription and add the messageCid to the appropriate array
        const proto2Handler = async (message:GenericMessage):Promise<void> => {
          const messageCid = await Message.getCid(message);
          proto2Messages.push(messageCid);
        };

        // subscribe to proto2 messages
        const proto2Subscription = await TestDataGenerator.generateEventsSubscribe({ author: alice, filters: [{ protocol: proto2 }] });
        const proto2SubscriptionReply = await dwn.processMessage(alice.did, proto2Subscription.message, { subscriptionHandler: proto2Handler });
        expect(proto2SubscriptionReply.status.code).to.equal(200);
        expect(proto2SubscriptionReply.subscription?.id).to.equal(await Message.getCid(proto2Subscription.message));

        // create some random record, will not show up in records subscription
        const write1Random = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const write1RandomResponse = await dwn.processMessage(alice.did, write1Random.message, { dataStream: write1Random.dataStream });
        expect(write1RandomResponse.status.code).to.equal(202);

        // create a record for proto1
        const write1proto1 = await TestDataGenerator.generateRecordsWrite({ author: alice, protocol: proto1, ...postProperties });
        const write1Response = await dwn.processMessage(alice.did, write1proto1.message, { dataStream: write1proto1.dataStream });
        expect(write1Response.status.code).equals(202);

        // create a record for proto2
        const write1proto2 = await TestDataGenerator.generateRecordsWrite({ author: alice, protocol: proto2, ...postProperties });
        const write1Proto2Response = await dwn.processMessage(alice.did, write1proto2.message, { dataStream: write1proto2.dataStream });
        expect(write1Proto2Response.status.code).equals(202);

        expect(proto1Messages.length).to.equal(1, 'proto1');
        expect(proto1Messages).to.include(await Message.getCid(write1proto1.message));
        expect(proto2Messages.length).to.equal(1, 'proto2');
        expect(proto2Messages).to.include(await Message.getCid(write1proto2.message));

        // remove listener for proto1
        proto1SubscriptionReply.subscription?.close();

        // create another record for proto1
        const write2proto1 = await TestDataGenerator.generateRecordsWrite({ author: alice, protocol: proto1, ...postProperties });
        const write2Response = await dwn.processMessage(alice.did, write2proto1.message, { dataStream: write2proto1.dataStream });
        expect(write2Response.status.code).equals(202);

        // create another record for proto2
        const write2proto2 = await TestDataGenerator.generateRecordsWrite({ author: alice, protocol: proto2, ...postProperties });
        const write2Proto2Response = await dwn.processMessage(alice.did, write2proto2.message, { dataStream: write2proto2.dataStream });
        expect(write2Proto2Response.status.code).equals(202);

        // proto1 messages from handler do not change.
        expect(proto1Messages.length).to.equal(1, 'proto1 after subscription.off()');
        expect(proto1Messages).to.include(await Message.getCid(write1proto1.message));

        //proto2 messages from handler have the new message.
        expect(proto2Messages.length).to.equal(2, 'proto2 after subscription.off()');
        expect(proto2Messages).to.have.members([await Message.getCid(write1proto2.message), await Message.getCid(write2proto2.message)]);
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
  });
}