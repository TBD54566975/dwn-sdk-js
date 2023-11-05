import chaiAsPromised from 'chai-as-promised';
import { Dwn } from '../../src/dwn.js';
import type { EventMessage } from '../../src/interfaces/event-create.js';
import type { EventStreamI } from '../../src/event-log/event-stream.js';
import { EventType } from '../../src/types/event-types.js';
import sinon from 'sinon';
import { SubscriptionRequest } from '../../src/interfaces/subscription-request.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStores } from '../test-stores.js';

import chai, { assert, expect } from 'chai';
import type { DataStore, EventLog, MessageStore } from '../../src/index.js';
import {
  DidKeyResolver,
  DidResolver,
  DwnInterfaceName,
  DwnMethodName,
  Jws,
  Message,
} from '../../src/index.js';

chai.use(chaiAsPromised);

export function testSubscriptionRequestHandler(): void {
  describe('SubscriptionRequest.handle()', () => {
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let eventStream: EventStreamI;
    let eventLog: EventLog;
    let dwn: Dwn;

    describe('functional tests', () => {
      // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
      // so that different test suites can reuse the same backend store for testing
      before(async () => {
        didResolver = new DidResolver([new DidKeyResolver()]);

        const stores = TestStores.get();
        messageStore = stores.messageStore;
        dataStore = stores.dataStore;
        eventLog = stores.eventLog;
        eventStream = stores.eventStream as EventStreamI;
        dwn = await Dwn.create({
          didResolver,
          messageStore,
          dataStore,
          eventLog,
          eventStream,
        });
      });

      beforeEach(async () => {
        sinon.restore(); // wipe all previous stubs/spies/mocks/fakes

        // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
        await messageStore.clear();
        await dataStore.clear();
        await eventLog.clear();
        // await (eventStream as EventStreamI).clear();
      });

      after(async () => {
        await dwn.close();
      });

      it('should allow tenant to subscribe their own event stream', async () => {
        const alice = await DidKeyResolver.generate();

        // testing Subscription Request
        const subscriptionRequest = await SubscriptionRequest.create({
          signer: Jws.createSigner(alice),
        });

        const subscriptionReply = await dwn.handleSubscriptionRequest(
          alice.did,
          subscriptionRequest.message );
        expect(subscriptionReply.status.code).to.equal(
          200,
          subscriptionReply.status.detail
        );
        expect(subscriptionReply.subscription).to.exist;
        // set up subscription...
        try {
          let messageReceived: EventMessage;
          const eventHandledPromise = new Promise<void>((resolve, reject) => {
            subscriptionReply.subscription?.emitter?.on(
              async (e: EventMessage) => {
                try {
                  messageReceived = e;
                  resolve(); // Resolve the promise when the event is handled.
                } catch (error) {
                  reject(error);
                }
              }
            );
          });
          const { message, dataStream } =
            await TestDataGenerator.generateRecordsWrite({ author: alice });
          const writeReply = await dwn.processMessage(
            alice.did,
            message,
            dataStream
          );
          expect(writeReply.status.code).to.equal(202);
          await eventHandledPromise;
          expect(messageReceived!).to.be.not.undefined;
          expect(messageReceived!.message.descriptor).to.not.be.undefined;
          expect(message.descriptor.dataCid).to.deep.equal(
            messageReceived!.message.descriptor.eventDescriptor.dataCid
          );
        } catch (error) {
          assert.fail(error, undefined, 'Test failed due to an error' + error);
        }
      });

      it('should not allow non-tenant to subscribe their an event stream', async () => {
        //    const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();

        // testing Subscription Request
        const subscriptionRequest = await SubscriptionRequest.create({
          filter: {
            eventType: EventType.Operation,
          },
        });
        const subscriptionReply = await dwn.handleSubscriptionRequest(
          bob.did, subscriptionRequest.message);
        expect(subscriptionReply.status.code).to.equal(
          401,
          subscriptionReply.status.detail
        );
        expect(subscriptionReply.subscription).to.not.exist;
      });

      it('should allow a non-tenant to read subscriptions stream access they are authorized to', async () => {
        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();

        // Alice gives Bob a PermissionsGrant with scope RecordsRead
        const permissionsGrant =
          await TestDataGenerator.generatePermissionsGrant({
            author     : alice,
            grantedBy  : alice.did,
            grantedFor : alice.did,
            grantedTo  : bob.did,
            scope      : {
              interface : DwnInterfaceName.Subscriptions,
              method    : DwnMethodName.Request,
            },
          });

        const permissionsGrantReply = await dwn.processMessage(
          alice.did,
          permissionsGrant.message
        );
        expect(permissionsGrantReply.status.code).to.equal(202);

        // testing Subscription Request
        const subscriptionRequest = await SubscriptionRequest.create({
          filter: {
            eventType: EventType.Operation,
          },
          signer             : Jws.createSigner(bob),
          permissionsGrantId : await Message.getCid(permissionsGrant.message),
        });

        const subscriptionReply = await dwn.handleSubscriptionRequest(alice.did, subscriptionRequest.message);
        expect(subscriptionReply.status.code).to.equal(
          200,
          subscriptionReply.status.detail
        );
        assert.exists(subscriptionReply.subscription, 'subscription exists');

        try {
          let messageReceived: EventMessage;
          const eventHandledPromise = new Promise<void>((resolve, reject) => {
            subscriptionReply.subscription?.emitter?.on(
              async (e: EventMessage) => {
                try {
                  messageReceived = e;
                  resolve(); // Resolve the promise when the event is handled.
                } catch (error) {
                  reject(error);
                }
              }
            );
          });

          const { message, dataStream } =
            await TestDataGenerator.generateRecordsWrite({ author: alice });
          const writeReply = await dwn.processMessage(
            alice.did,
            message,
            dataStream
          );
          expect(writeReply.status.code).to.equal(202);

          await eventHandledPromise;
          expect(messageReceived!).to.be.not.undefined;
          expect(messageReceived!.message.descriptor).to.not.be.undefined;
          expect(message.descriptor.dataCid).to.deep.equal(
            messageReceived!.message.descriptor.eventDescriptor.dataCid
          );
        } catch (error) {
          assert.fail(error, undefined, 'Test failed due to an error');
        }
      });

      it('should now allow a non-tenant to read subscriptions stream access they are authorized to, and then revoke permissions. they should no longer have access', async () => {
        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();

        // Alice gives Bob a PermissionsGrant with scope RecordsRead
        const permissionsGrant =
          await TestDataGenerator.generatePermissionsGrant({
            author     : alice,
            grantedBy  : alice.did,
            grantedFor : alice.did,
            grantedTo  : bob.did,
            scope      : {
              interface : DwnInterfaceName.Subscriptions,
              method    : DwnMethodName.Request,
            },
          });

        const permissionsGrantReply = await dwn.processMessage(
          alice.did,
          permissionsGrant.message
        );
        expect(permissionsGrantReply.status.code).to.equal(202);
        // testing Subscription Request
        const subscriptionRequest = await SubscriptionRequest.create({
          signer             : Jws.createSigner(bob),
          permissionsGrantId : await Message.getCid(permissionsGrant.message),
        });
        const subscriptionReply = await dwn.handleSubscriptionRequest(alice.did,subscriptionRequest.message);
        expect(subscriptionReply.status.code).to.equal(
          200,
          subscriptionReply.status.detail
        );
        assert.exists(subscriptionReply.subscription, 'subscription exists');

        // set up subscription...
        try {
          let messageReceived: EventMessage | undefined;
          const eventHandledPromise = new Promise<void>((resolve, reject) => {
            subscriptionReply.subscription?.emitter?.on(
              async (e: EventMessage) => {
                try {
                  messageReceived = e;
                  resolve(); // Resolve the promise when the event is handled.
                } catch (error) {
                  reject(error);
                }
              }
            );
          });

          let { message, dataStream } =
            await TestDataGenerator.generateRecordsWrite({ author: alice });
          let writeReply = await dwn.processMessage(
            alice.did,
            message,
            dataStream
          );
          expect(writeReply.status.code).to.equal(
            202,
            'could not write event...'
          );

          await eventHandledPromise;
          expect(messageReceived!).to.be.not.undefined;
          expect(messageReceived!.message.descriptor).to.not.be.undefined;
          expect(message.descriptor.dataCid).to.deep.equal(
            messageReceived!.message.descriptor.eventDescriptor.dataCid
          );
          messageReceived = undefined;
          // Alice revokes the grant
          const { permissionsRevoke } =
            await TestDataGenerator.generatePermissionsRevoke({
              author             : alice,
              permissionsGrantId : await Message.getCid(
                permissionsGrant.message
              ),
            });
          const permissionsRevokeReply = await dwn.processMessage(
            alice.did,
            permissionsRevoke.message
          );
          expect(permissionsRevokeReply.status.code).to.eq(202);
          // wait 100 ms to make sure it didn't propgate.
          await new Promise((resolve) => {
            setTimeout(resolve, 100);
          });
          assert.isUndefined(
            messageReceived,
            'message should be undefined on permission revoke...'
          );
          messageReceived = undefined;
          assert.isUndefined(
            messageReceived,
            'message should be undefined on write...'
          );
          ({ message, dataStream } =
            await TestDataGenerator.generateRecordsWrite({ author: alice }));
          writeReply = await dwn.processMessage(alice.did, message, dataStream);
          expect(writeReply.status.code).to.equal(202);
          await new Promise((resolve) => {
            setTimeout(resolve, 100);
          });
        } catch (error) {
          assert.fail(error, undefined, 'Test failed due to an error');
        }
      });
    });
  });
}
testSubscriptionRequestHandler();
