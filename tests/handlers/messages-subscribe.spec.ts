import type { DidResolver } from '@web5/dids';
import type { DataStore, EventLog, MessageStore, ProtocolDefinition, ResumableTaskStore } from '../../src/index.js';
import type { EventStream, MessageEvent } from '../../src/types/subscriptions.js';

import { Dwn } from '../../src/dwn.js';
import { DwnErrorCode } from '../../src/core/dwn-error.js';
import freeForAll from '../vectors/protocol-definitions/free-for-all.json' assert { type: 'json' };
import { Jws } from '../../src/utils/jws.js';
import { Message } from '../../src/core/message.js';
import { MessagesSubscribe } from '../../src/interfaces/messages-subscribe.js';
import { MessagesSubscribeHandler } from '../../src/handlers/messages-subscribe.js';
import { Poller } from '../utils/poller.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { DidKey, UniversalResolver } from '@web5/dids';
import { DwnInterfaceName, DwnMethodName } from '../../src/index.js';

import sinon from 'sinon';
import chai, { expect } from 'chai';

import chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);

export function testMessagesSubscribeHandler(): void {
  describe('MessagesSubscribe.handle()', () => {

    describe('EventStream disabled',() => {
      let didResolver: DidResolver;
      let messageStore: MessageStore;
      let dataStore: DataStore;
      let resumableTaskStore: ResumableTaskStore;
      let eventLog: EventLog;
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

        dwn = await Dwn.create({
          didResolver,
          messageStore,
          dataStore,
          resumableTaskStore,
          eventLog,
        });

      });


      beforeEach(async () => {
        sinon.restore(); // wipe all previous stubs/spies/mocks/fakes

        // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
        await messageStore.clear();
        await dataStore.clear();
        await resumableTaskStore.clear();
        await eventLog.clear();
      });

      after(async () => {
        await dwn.close();
      });

      it('should respond with a 501 if subscriptions are not supported', async () => {
        await dwn.close(); // close the original dwn instance
        dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog, resumableTaskStore }); // leave out eventStream

        const alice = await TestDataGenerator.generateDidKeyPersona();
        // attempt to subscribe
        const { message } = await MessagesSubscribe.create({ signer: Jws.createSigner(alice) });
        const subscriptionMessageReply = await dwn.processMessage(alice.did, message, { subscriptionHandler: (_) => {} });
        expect(subscriptionMessageReply.status.code).to.equal(501, subscriptionMessageReply.status.detail);
        expect(subscriptionMessageReply.status.detail).to.include(DwnErrorCode.MessagesSubscribeEventStreamUnimplemented);
      });
    });

    describe('EventStream enabled', () => {
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

        dwn = await Dwn.create({
          didResolver,
          messageStore,
          dataStore,
          resumableTaskStore,
          eventLog,
          eventStream,
        });

      });

      beforeEach(async () => {
        sinon.restore(); // wipe all previous stubs/spies/mocks/fakes

        // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
        await messageStore.clear();
        await dataStore.clear();
        await resumableTaskStore.clear();
        await eventLog.clear();
      });

      after(async () => {
        await dwn.close();
      });

      it('returns a 400 if message is invalid', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const { message } = await TestDataGenerator.generateMessagesSubscribe({ author: alice });

        // add an invalid property to the descriptor
        (message['descriptor'] as any)['invalid'] = 'invalid';

        const messagesSubscribeHandler = new MessagesSubscribeHandler(didResolver, messageStore, eventStream);

        const reply = await messagesSubscribeHandler.handle({ tenant: alice.did, message, subscriptionHandler: (_) => {} });
        expect(reply.status.code).to.equal(400);
      });


      it('should allow tenant to subscribe their own event stream', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // set up a promise to read later that captures the emitted messageCid
        let handler;
        const messageSubscriptionPromise: Promise<string> = new Promise((resolve) => {
          handler = async (event: MessageEvent):Promise<void> => {
            const { message } = event;
            const messageCid = await Message.getCid(message);
            resolve(messageCid);
          };
        });

        // testing MessagesSubscribe
        const messagesSubscribe = await MessagesSubscribe.create({
          signer: Jws.createSigner(alice),
        });
        const subscriptionReply = await dwn.processMessage(alice.did, messagesSubscribe.message, { subscriptionHandler: handler });
        expect(subscriptionReply.status.code).to.equal(200, subscriptionReply.status.detail);
        expect(subscriptionReply.subscription).to.not.be.undefined;

        const messageWrite = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const writeReply = await dwn.processMessage(alice.did, messageWrite.message, { dataStream: messageWrite.dataStream });
        expect(writeReply.status.code).to.equal(204);
        const messageCid = await Message.getCid(messageWrite.message);

        // control: ensure that the event exists
        const { events } = await eventLog.getEvents(alice.did);
        expect(events.length).to.equal(1);
        expect(events[0]).to.equal(messageCid);

        // await the event
        await expect(messageSubscriptionPromise).to.eventually.equal(messageCid);
      });

      it('should not allow non-tenant to subscribe to an event stream they are not authorized for', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        // test anonymous request
        const anonymousSubscription = await TestDataGenerator.generateMessagesSubscribe();
        delete (anonymousSubscription.message as any).authorization;

        const anonymousReply = await dwn.processMessage(alice.did, anonymousSubscription.message);
        expect(anonymousReply.status.code).to.equal(400);
        expect(anonymousReply.status.detail).to.include(`MessagesSubscribe: must have required property 'authorization'`);
        expect(anonymousReply.subscription).to.be.undefined;

        // testing MessagesSubscribe
        const messagesSubscribe = await MessagesSubscribe.create({
          signer: Jws.createSigner(bob),
        });

        const subscriptionReply = await dwn.processMessage(alice.did, messagesSubscribe.message);
        expect(subscriptionReply.status.code).to.equal(401);
        expect(subscriptionReply.subscription).to.be.undefined;
      });

      describe('grant based subscribes', () => {
        it('allows subscribe of messages with matching interface and method grant scope', async () => {
          // scenario: Alice gives Bob permission to subscribe for all of her messages
          // Alice writes various messages
          // When Bob subscribes for messages, he should receive updates to all of Alice's messages

          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          // create grant that is scoped to `MessagesSubscribe` for bob
          const { message: grantMessage, dataStream } = await TestDataGenerator.generateGrantCreate({
            author    : alice,
            grantedTo : bob,
            scope     : {
              interface : DwnInterfaceName.Messages,
              method    : DwnMethodName.Subscribe
            }
          });
          const grantReply = await dwn.processMessage(alice.did, grantMessage, { dataStream });
          expect(grantReply.status.code).to.equal(204);

          // create a handler to capture the emitted messageCids
          const messageCids: string[] = [];
          const handler = async (event: MessageEvent):Promise<void> => {
            const { message } = event;
            const messageCid = await Message.getCid(message);
            messageCids.push(messageCid);
          };

          // subscribe to messages
          const { message: subscribeMessage } = await TestDataGenerator.generateMessagesSubscribe({
            author            : bob,
            permissionGrantId : grantMessage.recordId,
          });

          const subscribeReply = await dwn.processMessage(alice.did, subscribeMessage, { subscriptionHandler: handler });
          expect(subscribeReply.status.code).to.equal(200);

          // configure the freeForAll protocol
          const { message: freeForAllConfigure } = await TestDataGenerator.generateProtocolsConfigure({
            author             : alice,
            protocolDefinition : freeForAll,
          });
          const { status: freeForAllReplyStatus } = await dwn.processMessage(alice.did, freeForAllConfigure);
          expect(freeForAllReplyStatus.code).to.equal(202);

          // configure a random protocol configuration
          const { message: protocolMessage } = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
          });
          const { status: configureStatus } = await dwn.processMessage(alice.did, protocolMessage);
          expect(configureStatus.code).to.equal(202);

          // write a message to the Records free for all interface
          const { message: recordMessage, dataStream: recordDataStream } = await TestDataGenerator.generateRecordsWrite({
            protocol     : freeForAll.protocol,
            protocolPath : 'post',
            schema       : freeForAll.types.post.schema,
            author       : alice
          });

          const recordReply = await dwn.processMessage(alice.did, recordMessage, { dataStream: recordDataStream });
          expect(recordReply.status.code).to.equal(204);

          // write a random message
          const { message: randomMessage, dataStream: randomDataStream } = await TestDataGenerator.generateRecordsWrite({
            author: alice
          });
          const randomReply = await dwn.processMessage(alice.did, randomMessage, { dataStream: randomDataStream });
          expect(randomReply.status.code).to.equal(204);

          // ensure that all messages have been received
          await Poller.pollUntilSuccessOrTimeout(async () => {
            expect(messageCids.length).to.equal(4);
            expect(messageCids).to.have.members([
              await Message.getCid(freeForAllConfigure),
              await Message.getCid(protocolMessage),
              await Message.getCid(recordMessage),
              await Message.getCid(randomMessage),
            ]);
          });
        });

        it('rejects subscribe of messages with mismatching interface grant scope', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          // create grant that is scoped to `RecordsWrite` for bob scoped to the `freeForAll` protocol
          const { message: grantMessage, dataStream } = await TestDataGenerator.generateGrantCreate({
            author    : alice,
            grantedTo : bob,
            scope     : {
              interface : DwnInterfaceName.Records,
              method    : DwnMethodName.Write,
              protocol  : freeForAll.protocol
            }
          });
          const grantReply = await dwn.processMessage(alice.did, grantMessage, { dataStream });
          expect(grantReply.status.code).to.equal(204);

          // bob attempts to use the `RecordsWrite` grant on an `MessagesSubscribe` message
          const { message: bobSubscribe } = await TestDataGenerator.generateMessagesSubscribe({
            author            : bob,
            permissionGrantId : grantMessage.recordId
          });
          const bobReply = await dwn.processMessage(alice.did, bobSubscribe);
          expect(bobReply.status.code).to.equal(401);
          expect(bobReply.status.detail).to.include(DwnErrorCode.GrantAuthorizationInterfaceMismatch);
        });

        xit('rejects subscribe of messages with mismatching method grant scopes', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          // create grant that is scoped to `MessagesQuery` for bob scoped to the `freeForAll` protocol
          const { recordsWrite: grantWrite, dataStream } = await TestDataGenerator.generateGrantCreate({
            author    : alice,
            grantedTo : bob,
            scope     : {
              interface : DwnInterfaceName.Messages,
              method    : DwnMethodName.Query,
            }
          });
          const grantWriteReply = await dwn.processMessage(alice.did, grantWrite.message, { dataStream });
          expect(grantWriteReply.status.code).to.equal(204);


          // bob attempts to use the `MessagesQuery` grant on an `MessagesSubscribe` message
          const { message: bobSubscribe } = await TestDataGenerator.generateMessagesSubscribe({
            author            : bob,
            permissionGrantId : grantWrite.message.recordId
          });
          const bobReply = await dwn.processMessage(alice.did, bobSubscribe);
          expect(bobReply.status.code).to.equal(401);
          expect(bobReply.status.detail).to.include(DwnErrorCode.GrantAuthorizationMethodMismatch);
        });

        describe('protocol filtered messages', () => {
          it('allows subscribe of protocol filtered messages with matching protocol grant scopes', async () => {

            const alice = await TestDataGenerator.generateDidKeyPersona();
            const bob = await TestDataGenerator.generateDidKeyPersona();

            // install protocol 1
            const protocol1: ProtocolDefinition = { ...freeForAll, published: true, protocol: 'http://protcol1' };
            const { message: protocol1Configure } = await TestDataGenerator.generateProtocolsConfigure({
              author             : alice,
              protocolDefinition : protocol1,
            });
            const { status: protocol1ConfigureStatus } = await dwn.processMessage(alice.did, protocol1Configure);
            expect(protocol1ConfigureStatus.code).to.equal(202);

            // install protocol 2
            const protocol2: ProtocolDefinition = { ...freeForAll, published: true, protocol: 'http://protcol2' };
            const { message: protocol2Configure } = await TestDataGenerator.generateProtocolsConfigure({
              author             : alice,
              protocolDefinition : protocol2,
            });
            const { status: protocol2ConfigureStatus } = await dwn.processMessage(alice.did, protocol2Configure);
            expect(protocol2ConfigureStatus.code).to.equal(202);

            // grant bob permission to subscribe for protocol 1
            const { message: grant1Message, dataStream: grant1DataStream } = await TestDataGenerator.generateGrantCreate({
              author    : alice,
              grantedTo : bob,
              scope     : {
                interface : DwnInterfaceName.Messages,
                method    : DwnMethodName.Subscribe,
                protocol  : protocol1.protocol
              }
            });

            const grant1Reply = await dwn.processMessage(alice.did, grant1Message, { dataStream: grant1DataStream });
            expect(grant1Reply.status.code).to.equal(204);

            // bob uses the grant to subscribe to protocol 1 messages
            const proto1MessageCids: string[] = [];
            const proto1Handler = async (event: MessageEvent):Promise<void> => {
              const { message } = event;
              const messageCid = await Message.getCid(message);
              proto1MessageCids.push(messageCid);
            };

            const { message: bobSubscribe1 } = await TestDataGenerator.generateMessagesSubscribe({
              author            : bob,
              filters           : [{ protocol: protocol1.protocol }],
              permissionGrantId : grant1Message.recordId
            });
            const bobReply1 = await dwn.processMessage(alice.did, bobSubscribe1, { subscriptionHandler: proto1Handler });
            expect(bobReply1.status.code).to.equal(200);

            const allMessages: string[] = [];
            const allHandler = async (event: MessageEvent):Promise<void> => {
              const { message } = event;
              const messageCid = await Message.getCid(message);
              allMessages.push(messageCid);
            };

            const { message: allSubscribe } = await TestDataGenerator.generateMessagesSubscribe({
              author: alice,
            });
            const allReply = await dwn.processMessage(alice.did, allSubscribe, { subscriptionHandler: allHandler });
            expect(allReply.status.code).to.equal(200);

            // alice writes a message to protocol 1
            const { message: proto1Message, dataStream: proto1DataStream } = await TestDataGenerator.generateRecordsWrite({
              protocol     : protocol1.protocol,
              protocolPath : 'post',
              schema       : protocol1.types.post.schema,
              author       : alice
            });
            const proto1Reply = await dwn.processMessage(alice.did, proto1Message, { dataStream: proto1DataStream });
            expect(proto1Reply.status.code).to.equal(204);

            // alice writes a message to protocol 2
            const { message: proto2Message, dataStream: proto2DataStream } = await TestDataGenerator.generateRecordsWrite({
              protocol     : protocol2.protocol,
              protocolPath : 'post',
              schema       : protocol2.types.post.schema,
              author       : alice
            });
            const proto2Reply = await dwn.processMessage(alice.did, proto2Message, { dataStream: proto2DataStream });
            expect(proto2Reply.status.code).to.equal(204);

            // ensure that all messages have been received as a control
            await Poller.pollUntilSuccessOrTimeout(async () => {
              expect(allMessages.length).to.equal(2);
              expect(allMessages).to.have.members([
                await Message.getCid(proto1Message),
                await Message.getCid(proto2Message)
              ]);

              // proto 1 messages should only have one message
              expect(proto1MessageCids.length).to.equal(1);
              expect(proto1MessageCids).to.have.members([await Message.getCid(proto1Message) ]);
            });

          });

          it('rejects subscribe of protocol filtered messages with mismatching protocol grant scopes', async () => {
            const alice = await TestDataGenerator.generateDidKeyPersona();
            const bob = await TestDataGenerator.generateDidKeyPersona();

            // install protocol 1
            const protocol1: ProtocolDefinition = { ...freeForAll, published: true, protocol: 'http://protcol1' };
            const { message: protocol1Configure } = await TestDataGenerator.generateProtocolsConfigure({
              author             : alice,
              protocolDefinition : protocol1,
            });
            const { status: protocol1ConfigureStatus } = await dwn.processMessage(alice.did, protocol1Configure);
            expect(protocol1ConfigureStatus.code).to.equal(202);

            // install protocol 2
            const protocol2: ProtocolDefinition = { ...freeForAll, published: true, protocol: 'http://protcol2' };
            const { message: protocol2Configure } = await TestDataGenerator.generateProtocolsConfigure({
              author             : alice,
              protocolDefinition : protocol2,
            });
            const { status: protocol2ConfigureStatus } = await dwn.processMessage(alice.did, protocol2Configure);
            expect(protocol2ConfigureStatus.code).to.equal(202);

            // grant bob permission to subscribe for protocol 1
            const { message: grant1Message, dataStream: grant1DataStream } = await TestDataGenerator.generateGrantCreate({
              author    : alice,
              grantedTo : bob,
              scope     : {
                interface : DwnInterfaceName.Messages,
                method    : DwnMethodName.Subscribe,
                protocol  : protocol1.protocol
              }
            });

            const grant1Reply = await dwn.processMessage(alice.did, grant1Message, { dataStream: grant1DataStream });
            expect(grant1Reply.status.code).to.equal(204);

            // bob uses the grant for protocol 1 to subscribe for protocol 2 messages
            const { message: bobSubscribe1 } = await TestDataGenerator.generateMessagesSubscribe({
              author            : bob,
              filters           : [{ protocol: protocol2.protocol }],
              permissionGrantId : grant1Message.recordId
            });
            const bobReply1 = await dwn.processMessage(alice.did, bobSubscribe1);
            expect(bobReply1.status.code).to.equal(401);
            expect(bobReply1.status.detail).to.include(DwnErrorCode.MessagesGrantAuthorizationMismatchedProtocol);
            expect(bobReply1.subscription).to.not.exist;

            // bob attempts to use the grant for protocol 1 to subscribe to messages in protocol 1 OR protocol 2 given two filters
            // this should fail because the grant is scoped to protocol 1 only
            const { message: bobSubscribe2 } = await TestDataGenerator.generateMessagesSubscribe({
              author            : bob,
              filters           : [{ protocol: protocol1.protocol }, { protocol: protocol2.protocol }],
              permissionGrantId : grant1Message.recordId
            });
            const bobReply2 = await dwn.processMessage(alice.did, bobSubscribe2);
            expect(bobReply2.status.code).to.equal(401);
            expect(bobReply2.status.detail).to.include(DwnErrorCode.MessagesGrantAuthorizationMismatchedProtocol);
            expect(bobReply2.subscription).to.not.exist;
          });
        });
      });
    });
  });
}