import type {
  DataStore,
  EventLog,
  EventStream,
  GenericMessage,
  MessageStore,
  RecordsDeleteMessage,
  RecordsWriteMessage,
} from '../../src/index.js';

import freeForAll from '../vectors/protocol-definitions/free-for-all.json' assert { type: 'json' };
import friendRole from '../vectors/protocol-definitions/friend-role.json' assert { type: 'json' };

import { RecordsSubscriptionHandler } from '../../src/handlers/records-subscribe.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStores } from '../test-stores.js';
import { Time } from '../../src/utils/time.js';
import { DidKeyResolver, DidResolver, Dwn, EventStreamEmitter, Message } from '../../src/index.js';

import { expect } from 'chai';
import sinon from 'sinon';

export function testSubscriptionScenarios(): void {
  describe('subscriptions', () => {
    describe('without reauthorization', () => {
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
        eventStream = new EventStreamEmitter({ messageStore, didResolver });

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

      describe('records subscribe', () => {
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

          // subscribe to proto1 messages
          const proto1Subscription = await TestDataGenerator.generateRecordsSubscribe({ author: alice, filter: { protocol: proto1 } });
          const proto1SubscriptionReply = await dwn.processMessage(alice.did, proto1Subscription.message);
          expect(proto1SubscriptionReply.status.code).to.equal(200);
          expect(proto1SubscriptionReply.subscription?.id).to.equal(await Message.getCid(proto1Subscription.message));

          // we add a handler to the subscription and add the messageCid to the appropriate array
          const proto1Handler = async (message:GenericMessage):Promise<void> => {
            const messageCid = await Message.getCid(message);
            proto1Messages.push(messageCid);
          };
          const proto1Sub = proto1SubscriptionReply.subscription!.on(proto1Handler);

          // subscribe to proto2 messages
          const proto2Subscription = await TestDataGenerator.generateRecordsSubscribe({ author: alice, filter: { protocol: proto2 } });
          const proto2SubscriptionReply = await dwn.processMessage(alice.did, proto2Subscription.message);
          expect(proto2SubscriptionReply.status.code).to.equal(200);
          expect(proto2SubscriptionReply.subscription?.id).to.equal(await Message.getCid(proto2Subscription.message));
          // we add a handler to the subscription and add the messageCid to the appropriate array
          const proto2Handler = async (message:GenericMessage):Promise<void> => {
            const messageCid = await Message.getCid(message);
            proto2Messages.push(messageCid);
          };
          proto2SubscriptionReply.subscription!.on(proto2Handler);

          // create some random record, will not show up in records subscription
          const write1Random = await TestDataGenerator.generateRecordsWrite({ author: alice });
          const write1RandomResponse = await dwn.processMessage(alice.did, write1Random.message, write1Random.dataStream);
          expect(write1RandomResponse.status.code).to.equal(202);

          // create a record for proto1
          const write1proto1 = await TestDataGenerator.generateRecordsWrite({ author: alice, protocol: proto1, ...postProperties });
          const write1Response = await dwn.processMessage(alice.did, write1proto1.message, write1proto1.dataStream);
          expect(write1Response.status.code).equals(202);

          // create a record for proto2
          const write1proto2 = await TestDataGenerator.generateRecordsWrite({ author: alice, protocol: proto2, ...postProperties });
          const write1Proto2Response = await dwn.processMessage(alice.did, write1proto2.message, write1proto2.dataStream);
          expect(write1Proto2Response.status.code).equals(202);

          expect(proto1Messages.length).to.equal(1, 'proto1');
          expect(proto1Messages).to.include(await Message.getCid(write1proto1.message));
          expect(proto2Messages.length).to.equal(1, 'proto2');
          expect(proto2Messages).to.include(await Message.getCid(write1proto2.message));

          // remove listener for proto1
          proto1Sub.off();

          // create another record for proto1
          const write2proto1 = await TestDataGenerator.generateRecordsWrite({ author: alice, protocol: proto1, ...postProperties });
          const write2Response = await dwn.processMessage(alice.did, write2proto1.message, write2proto1.dataStream);
          expect(write2Response.status.code).equals(202);

          // create another record for proto2
          const write2proto2 = await TestDataGenerator.generateRecordsWrite({ author: alice, protocol: proto2, ...postProperties });
          const write2Proto2Response = await dwn.processMessage(alice.did, write2proto2.message, write2proto2.dataStream);
          expect(write2Proto2Response.status.code).equals(202);

          // proto1 messages from handler do not change.
          expect(proto1Messages.length).to.equal(1, 'proto1 after subscription.off()');
          expect(proto1Messages).to.include(await Message.getCid(write1proto1.message));

          //proto2 messages from handler have the new message.
          expect(proto2Messages.length).to.equal(2, 'proto2 after subscription.off()');
          expect(proto2Messages).to.have.members([await Message.getCid(write1proto2.message), await Message.getCid(write2proto2.message)]);
        });

        it('unsubscribes', async () => {
          const alice = await DidKeyResolver.generate();

          // subscribe to schema1
          const schema1Subscription = await TestDataGenerator.generateRecordsSubscribe({ author: alice, filter: { schema: 'schema1' } });
          const schema1SubscriptionRepl = await dwn.processMessage(alice.did, schema1Subscription.message);
          expect(schema1SubscriptionRepl.status.code).to.equal(200);

          // messageCids of schema1
          const schema1Messages:string[] = [];

          const schema1Handler = async (message: GenericMessage): Promise<void> => {
            const messageCid = await Message.getCid(message);
            schema1Messages.push(messageCid);
          };
          schema1SubscriptionRepl.subscription!.on(schema1Handler);
          expect(schema1Messages.length).to.equal(0); // no messages exist;

          const record1 = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'schema1' });
          const record1Reply = await dwn.processMessage(alice.did, record1.message, record1.dataStream);
          expect(record1Reply.status.code).to.equal(202);
          const record1MessageCid = await Message.getCid(record1.message);

          expect(schema1Messages.length).to.equal(1); // message exists
          expect(schema1Messages).to.eql([ record1MessageCid ]);

          // unsubscribe, this should be used as clean up.
          await schema1SubscriptionRepl.subscription!.close();

          // write another message.
          const record2 = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'schema1' });
          const record2Reply = await dwn.processMessage(alice.did, record2.message, record2.dataStream);
          expect(record2Reply.status.code).to.equal(202);

          expect(schema1Messages.length).to.equal(1); // same as before
          expect(schema1Messages).to.eql([ record1MessageCid ]);
        });
      });

      describe('events subscribe', () => {
        it('all events', async () => {
          const alice = await DidKeyResolver.generate();

          // subscribe to all messages
          const eventsSubscription = await TestDataGenerator.generateEventsSubscribe({ author: alice });
          const eventsSubscriptionReply = await dwn.processMessage(alice.did, eventsSubscription.message);
          expect(eventsSubscriptionReply.status.code).to.equal(200);
          expect(eventsSubscriptionReply.subscription?.id).to.equal(await Message.getCid(eventsSubscription.message));

          // create a handler that adds the messageCid of each message to an array.
          const messageCids: string[] = [];
          const messageHandler = async (message: GenericMessage): Promise<void> => {
            const messageCid = await Message.getCid(message);
            messageCids.push(messageCid);
          };
          const handler = eventsSubscriptionReply.subscription!.on(messageHandler);

          // generate various messages
          const write1 = await TestDataGenerator.generateRecordsWrite({ author: alice });
          const write1MessageCid = await Message.getCid(write1.message);
          const write1Reply = await dwn.processMessage(alice.did, write1.message, write1.dataStream);
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
          handler.off();

          // create a message after
          const write2 = await TestDataGenerator.generateRecordsWrite({ author: alice });
          const write2Reply = await dwn.processMessage(alice.did, write2.message, write2.dataStream);
          expect(write2Reply.status.code).to.equal(202);

          await Time.minimalSleep();

          // test the messageCids array for the appropriate messages
          expect(messageCids.length).to.equal(4);
          expect(messageCids).to.eql([ write1MessageCid, grant1MessageCid, protocol1MessageCid, delete1MessageCid ]);
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

          // subscribe to proto1 messages
          const proto1Subscription = await TestDataGenerator.generateEventsSubscribe({ author: alice, filters: [{ protocol: proto1 }] });
          const proto1SubscriptionReply = await dwn.processMessage(alice.did, proto1Subscription.message);
          expect(proto1SubscriptionReply.status.code).to.equal(200);
          expect(proto1SubscriptionReply.subscription?.id).to.equal(await Message.getCid(proto1Subscription.message));

          // we add a handler to the subscription and add the messageCid to the appropriate array
          const proto1Handler = async (message:GenericMessage):Promise<void> => {
            const messageCid = await Message.getCid(message);
            proto1Messages.push(messageCid);
          };
          const proto1Sub = proto1SubscriptionReply.subscription!.on(proto1Handler);

          // subscribe to proto2 messages
          const proto2Subscription = await TestDataGenerator.generateEventsSubscribe({ author: alice, filters: [{ protocol: proto2 }] });
          const proto2SubscriptionReply = await dwn.processMessage(alice.did, proto2Subscription.message);
          expect(proto2SubscriptionReply.status.code).to.equal(200);
          expect(proto2SubscriptionReply.subscription?.id).to.equal(await Message.getCid(proto2Subscription.message));
          // we add a handler to the subscription and add the messageCid to the appropriate array
          const proto2Handler = async (message:GenericMessage):Promise<void> => {
            const messageCid = await Message.getCid(message);
            proto2Messages.push(messageCid);
          };
          proto2SubscriptionReply.subscription!.on(proto2Handler);

          // create some random record, will not show up in records subscription
          const write1Random = await TestDataGenerator.generateRecordsWrite({ author: alice });
          const write1RandomResponse = await dwn.processMessage(alice.did, write1Random.message, write1Random.dataStream);
          expect(write1RandomResponse.status.code).to.equal(202);

          // create a record for proto1
          const write1proto1 = await TestDataGenerator.generateRecordsWrite({ author: alice, protocol: proto1, ...postProperties });
          const write1Response = await dwn.processMessage(alice.did, write1proto1.message, write1proto1.dataStream);
          expect(write1Response.status.code).equals(202);

          // create a record for proto2
          const write1proto2 = await TestDataGenerator.generateRecordsWrite({ author: alice, protocol: proto2, ...postProperties });
          const write1Proto2Response = await dwn.processMessage(alice.did, write1proto2.message, write1proto2.dataStream);
          expect(write1Proto2Response.status.code).equals(202);

          expect(proto1Messages.length).to.equal(1, 'proto1');
          expect(proto1Messages).to.include(await Message.getCid(write1proto1.message));
          expect(proto2Messages.length).to.equal(1, 'proto2');
          expect(proto2Messages).to.include(await Message.getCid(write1proto2.message));

          // remove listener for proto1
          proto1Sub.off();

          // create another record for proto1
          const write2proto1 = await TestDataGenerator.generateRecordsWrite({ author: alice, protocol: proto1, ...postProperties });
          const write2Response = await dwn.processMessage(alice.did, write2proto1.message, write2proto1.dataStream);
          expect(write2Response.status.code).equals(202);

          // create another record for proto2
          const write2proto2 = await TestDataGenerator.generateRecordsWrite({ author: alice, protocol: proto2, ...postProperties });
          const write2Proto2Response = await dwn.processMessage(alice.did, write2proto2.message, write2proto2.dataStream);
          expect(write2Proto2Response.status.code).equals(202);

          // proto1 messages from handler do not change.
          expect(proto1Messages.length).to.equal(1, 'proto1 after subscription.off()');
          expect(proto1Messages).to.include(await Message.getCid(write1proto1.message));

          //proto2 messages from handler have the new message.
          expect(proto2Messages.length).to.equal(2, 'proto2 after subscription.off()');
          expect(proto2Messages).to.have.members([await Message.getCid(write1proto2.message), await Message.getCid(write2proto2.message)]);
        });
      });
    });

    describe('reauthorization', () => {
      let didResolver: DidResolver;
      let messageStore: MessageStore;
      let dataStore: DataStore;
      let eventLog: EventLog;
      let eventStream: EventStream;
      let dwn: Dwn;

      before(async () => {
        const stores = TestStores.get();
        messageStore = stores.messageStore;
        dataStore = stores.dataStore;
        eventLog = stores.eventLog;

        didResolver = new DidResolver([new DidKeyResolver()]);
        eventStream = new EventStreamEmitter({ messageStore, didResolver });

        dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog, eventStream });
      });

      after(async () => {
        sinon.restore();
        await dwn.close();
      });

      beforeEach(async () => {
        // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
        await messageStore.clear();
        await dataStore.clear();
        await eventLog.clear();
      });

      it('does not reauthorize if TTL is set to zero', async () => {
        const eventStream = new EventStreamEmitter({ messageStore, didResolver, reauthorizationTTL: 0 });
        dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog, eventStream });

        const authorizeSpy = sinon.spy(RecordsSubscriptionHandler.prototype as any, 'reauthorize');

        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();

        // alice writes the friend role protocol
        const protocolConf = await TestDataGenerator.generateProtocolsConfigure({
          author             : alice,
          published          : true,
          protocolDefinition : { ...friendRole }
        });
        const proto = protocolConf.message.descriptor.definition.protocol;
        const protoConfResponse = await dwn.processMessage(alice.did, protocolConf.message);
        expect(protoConfResponse.status.code).equals(202);

        // alice adds bob as a friend.
        const bobFriend = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          recipient    : bob.did,
          protocol     : proto,
          protocolPath : 'friend',
        });
        const bobFriendReply = await dwn.processMessage(alice.did, bobFriend.message, bobFriend.dataStream);
        expect(bobFriendReply.status.code).to.equal(202);

        // bob subscribes
        const bobSubscribe = await TestDataGenerator.generateRecordsSubscribe({
          author : bob,
          filter : {
            protocol     : proto,
            protocolPath : 'chat',
          },
          protocolRole: 'friend'
        });
        const bobSubscribeReply = await dwn.processMessage(alice.did, bobSubscribe.message);
        expect(bobSubscribeReply.status.code).to.equal(200);

        // capture the messageCids from the subscription
        const messageCids: string[] = [];
        const captureFunction = async (message: RecordsWriteMessage | RecordsDeleteMessage):Promise<void> => {
          const messageCid = await Message.getCid(message);
          messageCids.push(messageCid);
        };
        bobSubscribeReply.subscription!.on(captureFunction);

        //write some chat messages
        const aliceMessage1 = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : proto,
          protocolPath : 'chat'
        });
        const aliceMessage1Cid = await Message.getCid(aliceMessage1.message);
        const aliceMessage1Reply = await dwn.processMessage(alice.did, aliceMessage1.message, aliceMessage1.dataStream);
        expect(aliceMessage1Reply.status.code).to.equal(202);

        const aliceMessage2 = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : proto,
          protocolPath : 'chat'
        });
        const aliceMessage2Cid = await Message.getCid(aliceMessage2.message);
        const aliceMessage2Reply = await dwn.processMessage(alice.did, aliceMessage2.message, aliceMessage2.dataStream);
        expect(aliceMessage2Reply.status.code).to.equal(202);
        authorizeSpy.restore();

        while (messageCids.length < 2) {
          await Time.minimalSleep();
        }

        expect(authorizeSpy.callCount).to.equal(0, 'reauthorize'); // authorize is never called
        expect(messageCids.length).to.equal(2, 'messageCids');
        expect(messageCids).to.have.members([ aliceMessage1Cid, aliceMessage2Cid ]);
      });

      it('reauthorize on every event emitted if TTL is less than zero', async () => {
        const eventStream = new EventStreamEmitter({ messageStore, didResolver, reauthorizationTTL: -1 });
        dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog, eventStream });

        const authorizeSpy = sinon.spy(RecordsSubscriptionHandler.prototype as any, 'reauthorize');

        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();

        // alice writes the friend role protocol
        const protocolConf = await TestDataGenerator.generateProtocolsConfigure({
          author             : alice,
          published          : true,
          protocolDefinition : { ...friendRole }
        });
        const proto = protocolConf.message.descriptor.definition.protocol;
        const protoConfResponse = await dwn.processMessage(alice.did, protocolConf.message);
        expect(protoConfResponse.status.code).equals(202);

        // alice adds bob as a friend.
        const bobFriend = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          recipient    : bob.did,
          protocol     : proto,
          protocolPath : 'friend',
        });
        const bobFriendReply = await dwn.processMessage(alice.did, bobFriend.message, bobFriend.dataStream);
        expect(bobFriendReply.status.code).to.equal(202);

        // bob subscribes
        const bobSubscribe = await TestDataGenerator.generateRecordsSubscribe({
          author : bob,
          filter : {
            protocol     : proto,
            protocolPath : 'chat',
          },
          protocolRole: 'friend'
        });
        const bobSubscribeReply = await dwn.processMessage(alice.did, bobSubscribe.message);
        expect(bobSubscribeReply.status.code).to.equal(200);

        // capture the messageCids from the subscription
        const messageCids: string[] = [];
        const captureFunction = async (message: RecordsWriteMessage | RecordsDeleteMessage):Promise<void> => {
          const messageCid = await Message.getCid(message);
          messageCids.push(messageCid);
        };
        bobSubscribeReply.subscription!.on(captureFunction);

        //write some chat messages
        const aliceMessage1 = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : proto,
          protocolPath : 'chat'
        });
        const aliceMessage1Cid = await Message.getCid(aliceMessage1.message);
        const aliceMessage1Reply = await dwn.processMessage(alice.did, aliceMessage1.message, aliceMessage1.dataStream);
        expect(aliceMessage1Reply.status.code).to.equal(202);

        const aliceMessage2 = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : proto,
          protocolPath : 'chat'
        });
        const aliceMessage2Cid = await Message.getCid(aliceMessage2.message);
        const aliceMessage2Reply = await dwn.processMessage(alice.did, aliceMessage2.message, aliceMessage2.dataStream);
        expect(aliceMessage2Reply.status.code).to.equal(202);
        authorizeSpy.restore();

        while (messageCids.length < 2) {
          await Time.minimalSleep();
        }

        expect(authorizeSpy.callCount).to.equal(2, 'reauthorize'); // authorize on each message
        expect(messageCids.length).to.equal(2, 'messageCids');
        expect(messageCids).to.have.members([ aliceMessage1Cid, aliceMessage2Cid ]);
      });

      it('reauthorizes after the ttl', async () => {
        const clock = sinon.useFakeTimers();

        const eventStream = new EventStreamEmitter({ messageStore, didResolver, reauthorizationTTL: 1 }); // every second
        dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog, eventStream });

        const authorizeSpy = sinon.spy(RecordsSubscriptionHandler.prototype as any, 'reauthorize');

        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();

        // alice writes the friend role protocol
        const protocolConf = await TestDataGenerator.generateProtocolsConfigure({
          author             : alice,
          published          : true,
          protocolDefinition : { ...friendRole }
        });
        const proto = protocolConf.message.descriptor.definition.protocol;
        const protoConfResponse = await dwn.processMessage(alice.did, protocolConf.message);
        expect(protoConfResponse.status.code).equals(202);

        // alice adds bob as a friend.
        const bobFriend = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          recipient    : bob.did,
          protocol     : proto,
          protocolPath : 'friend',
        });
        const bobFriendReply = await dwn.processMessage(alice.did, bobFriend.message, bobFriend.dataStream);
        expect(bobFriendReply.status.code).to.equal(202);

        // bob subscribes
        const bobSubscribe = await TestDataGenerator.generateRecordsSubscribe({
          author : bob,
          filter : {
            protocol     : proto,
            protocolPath : 'chat',
          },
          protocolRole: 'friend'
        });
        const bobSubscribeReply = await dwn.processMessage(alice.did, bobSubscribe.message);
        expect(bobSubscribeReply.status.code).to.equal(200);

        // capture the messageCids from the subscription
        const messageCids: string[] = [];
        const captureFunction = async (message: RecordsWriteMessage | RecordsDeleteMessage):Promise<void> => {
          const messageCid = await Message.getCid(message);
          messageCids.push(messageCid);
        };
        bobSubscribeReply.subscription!.on(captureFunction);

        //write some chat messages
        const aliceMessage1 = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : proto,
          protocolPath : 'chat'
        });
        const aliceMessage1Cid = await Message.getCid(aliceMessage1.message);
        const aliceMessage1Reply = await dwn.processMessage(alice.did, aliceMessage1.message, aliceMessage1.dataStream);
        expect(aliceMessage1Reply.status.code).to.equal(202);

        const aliceMessage2 = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : proto,
          protocolPath : 'chat'
        });
        const aliceMessage2Cid = await Message.getCid(aliceMessage2.message);
        const aliceMessage2Reply = await dwn.processMessage(alice.did, aliceMessage2.message, aliceMessage2.dataStream);
        expect(aliceMessage2Reply.status.code).to.equal(202);

        await clock.nextAsync();

        expect(authorizeSpy.callCount).to.equal(0, 'reauthorize'); // has not reached TTL yet
        expect(messageCids.length).to.equal(2, 'messageCids');
        expect(messageCids).to.have.members([ aliceMessage1Cid, aliceMessage2Cid ]);

        await clock.tickAsync(1000);

        const aliceMessage3 = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : proto,
          protocolPath : 'chat'
        });
        const aliceMessage3Cid = await Message.getCid(aliceMessage3.message);
        const aliceMessage3Reply = await dwn.processMessage(alice.did, aliceMessage3.message, aliceMessage3.dataStream);
        expect(aliceMessage3Reply.status.code).to.equal(202);

        authorizeSpy.restore();
        clock.restore();

        while (messageCids.length < 3) {
          await Time.minimalSleep();
        }

        expect(authorizeSpy.callCount).to.equal(1, 'reauthorize'); // called once after the TTL has passed
        expect(messageCids.length).to.equal(3, 'messageCids');
        expect(messageCids).to.have.members([ aliceMessage1Cid, aliceMessage2Cid, aliceMessage3Cid ]);

      });

      it('no longer sends to subscription handler if subscription becomes un-authorized', async () => {
        const eventStream = new EventStreamEmitter({ messageStore, didResolver, reauthorizationTTL: -1 }); // reauthorize with each event
        dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog, eventStream });

        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();

        // spy on subscription close to test for
        const subscriptionCloseSpy = sinon.spy(RecordsSubscriptionHandler.prototype, 'close');

        // alice writes the friend role protocol
        const protocolConf = await TestDataGenerator.generateProtocolsConfigure({
          author             : alice,
          published          : true,
          protocolDefinition : { ...friendRole }
        });
        const proto = protocolConf.message.descriptor.definition.protocol;
        const protoConfResponse = await dwn.processMessage(alice.did, protocolConf.message);
        expect(protoConfResponse.status.code).equals(202);

        // alice adds bob as a friend.
        const bobFriend = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          recipient    : bob.did,
          protocol     : proto,
          protocolPath : 'friend',
        });
        const bobFriendReply = await dwn.processMessage(alice.did, bobFriend.message, bobFriend.dataStream);
        expect(bobFriendReply.status.code).to.equal(202);

        // bob subscribes
        const bobSubscribe = await TestDataGenerator.generateRecordsSubscribe({
          author : bob,
          filter : {
            protocol     : proto,
            protocolPath : 'chat',
          },
          protocolRole: 'friend'
        });
        const bobSubscribeReply = await dwn.processMessage(alice.did, bobSubscribe.message);
        expect(bobSubscribeReply.status.code).to.equal(200);


        // capture the messageCids from the subscription
        const messageCids: string[] = [];
        const captureFunction = async (message: RecordsWriteMessage | RecordsDeleteMessage):Promise<void> => {
          const messageCid = await Message.getCid(message);
          messageCids.push(messageCid);
        };
        bobSubscribeReply.subscription!.on(captureFunction);

        //write a chat messages
        const aliceMessage1 = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : proto,
          protocolPath : 'chat'
        });
        const aliceMessage1Cid = await Message.getCid(aliceMessage1.message);
        const aliceMessage1Reply = await dwn.processMessage(alice.did, aliceMessage1.message, aliceMessage1.dataStream);
        expect(aliceMessage1Reply.status.code).to.equal(202);

        // delete friend role
        const deleteBobFriend = await TestDataGenerator.generateRecordsDelete({
          author   : alice,
          recordId : bobFriend.message.recordId,
        });
        const deleteBobFriendReply = await dwn.processMessage(alice.did, deleteBobFriend.message);
        expect(deleteBobFriendReply.status.code).to.equal(202);

        const aliceMessage2 = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : proto,
          protocolPath : 'chat'
        });
        const aliceMessage2Reply = await dwn.processMessage(alice.did, aliceMessage2.message, aliceMessage2.dataStream);
        expect(aliceMessage2Reply.status.code).to.equal(202);

        const aliceMessage3 = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : proto,
          protocolPath : 'chat'
        });
        const aliceMessage3Reply = await dwn.processMessage(alice.did, aliceMessage3.message, aliceMessage3.dataStream);
        expect(aliceMessage3Reply.status.code).to.equal(202);

        await Time.minimalSleep();

        expect(messageCids.length).to.equal(1, 'messageCids');
        expect(messageCids).to.have.members([ aliceMessage1Cid ]);
        expect(subscriptionCloseSpy.called).to.be.true;
      });
    });
  });
}