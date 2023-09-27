import { Dwn } from '../../src/dwn.js';
import type { EventStreamI } from '../../src/event-log/event-stream.js';
import { expect } from 'chai';
import sinon from 'sinon';
import { SubscriptionRequest } from '../../src/interfaces/subscription-request.js';
import { TestStores } from '../test-stores.js';

import type { DataStore, EventLog, MessageStore } from '../../src/index.js';
import { DidKeyResolver, DidResolver, DwnInterfaceName, DwnMethodName, Jws } from '../../src/index.js';

export function testSubscriptionsRequestHandler(): void {
  describe('SubscriptionRequest.handle()', () => {
    describe('functional test', () => {

      let didResolver: DidResolver;
      let messageStore: MessageStore;
      let dataStore: DataStore;
      let eventLog: EventLog;
      let dwn: Dwn;
      let eventStream: EventStreamI;

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
        sinon.restore(); // wipe all previous stubs/spies/mocks/fakes

        // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
        await messageStore.clear();
        await dataStore.clear();
        await eventLog.clear();
        await eventStream.clear();
      });

      after(async () => {
        await dwn.close();
      });

      it('test create', async () => {

        const alice = await DidKeyResolver.generate();
        const { message } = await SubscriptionRequest.create({
          signer: Jws.createSigner(alice)
        });

        expect(message.descriptor.scope).to.eql({ interface: DwnInterfaceName.Subscriptions, method: DwnMethodName.Request });
      });

    });
  });
}

