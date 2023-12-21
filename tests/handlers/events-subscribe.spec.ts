import type { EventStream } from '../../src/types/subscriptions.js';
import type { DataStore, EventLog, GenericMessage, MessageStore } from '../../src/index.js';

import { DidKeyResolver } from '../../src/did/did-key-resolver.js';
import { DidResolver } from '../../src/did/did-resolver.js';
import { Dwn } from '../../src/dwn.js';
import { EventsSubscribe } from '../../src/interfaces/events-subscribe.js';
import { EventStreamEmitter } from '../../src/event-log/event-stream.js';
import { Jws } from '../../src/utils/jws.js';
import { Message } from '../../src/core/message.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStores } from '../test-stores.js';

import sinon from 'sinon';
import chai, { expect } from 'chai';

import chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);

export function testEventsSubscribeHandler(): void {
  describe('EventsSubscribe.handle()', () => {

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
    });

    after(async () => {
      await dwn.close();
    });

    it('should allow tenant to subscribe their own event stream', async () => {
      const alice = await DidKeyResolver.generate();

      // testing Subscription Request
      const subscriptionRequest = await EventsSubscribe.create({
        signer: Jws.createSigner(alice),
      });

      const subscriptionReply = await dwn.processMessage(alice.did, subscriptionRequest.message);
      expect(subscriptionReply.status.code).to.equal(200);
      expect(subscriptionReply.subscription).to.not.be.undefined;

      // set up a promise to read later that captures the emitted messageCid
      const messageSubscriptionPromise: Promise<string> = new Promise((resolve) => {
        const process = async (message: GenericMessage):Promise<void> => {
          const messageCid = await Message.getCid(message);
          resolve(messageCid);
        };
        subscriptionReply.subscription!.on(process);
      });

      const messageWrite = await TestDataGenerator.generateRecordsWrite({ author: alice });
      const writeReply = await dwn.processMessage(alice.did, messageWrite.message, messageWrite.dataStream);
      expect(writeReply.status.code).to.equal(202);
      const messageCid = await Message.getCid(messageWrite.message);

      // control: ensure that the event exists
      const events = await eventLog.getEvents(alice.did);
      expect(events.length).to.equal(1);
      expect(events[0]).to.equal(messageCid);

      // await the event
      await expect(messageSubscriptionPromise).to.eventually.equal(messageCid);
    });

    it('should not allow non-tenant to subscribe to an event stream they are not authorized for', async () => {
      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();

      // test anonymous request
      const anonymousSubscription = await EventsSubscribe.create({});
      expect(anonymousSubscription.message.authorization).to.be.undefined;

      const anonymousReply = await dwn.processMessage(alice.did, anonymousSubscription.message);
      expect(anonymousReply.status.code).to.equal(401);
      expect(anonymousReply.subscription).to.be.undefined;

      // testing Subscription Request
      const subscriptionRequest = await EventsSubscribe.create({
        signer: Jws.createSigner(bob),
      });

      const subscriptionReply = await dwn.processMessage(alice.did, subscriptionRequest.message);
      expect(subscriptionReply.status.code).to.equal(401);
      expect(subscriptionReply.subscription).to.be.undefined;
    });

    xit('should allow a non-tenant to subscribe to an event stream they are authorized for');

    xit('should not allow to subscribe after a grant as been revoked');

    xit('should not continue streaming messages after grant has been revoked');
  });
}