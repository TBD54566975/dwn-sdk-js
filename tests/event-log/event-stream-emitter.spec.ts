import type { EventStreamEmitter } from '../../src/event-log/event-stream.js';
import type { MessageStore } from '../../src/index.js';

import { TestStores } from '../test-stores.js';

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);

describe('EventStreamEmitter', () => {
  let eventStream: EventStreamEmitter;
  let messageStore: MessageStore;

  before(() => {
    ({ messageStore } = TestStores.get());
  });

  beforeEach(async () => {
    messageStore.clear();
  });

  after(async () => {
    // Clean up after each test by closing and clearing the event stream
    await messageStore.close();
    await eventStream.close();
  });

  // it('should remove listeners when unsubscribe method is used', async () => {
  //   const alice = await DidKeyResolver.generate();

  //   const emitter = new EventEmitter();
  //   eventStream = new EventStreamEmitter({ emitter });

  //   // count the `events_bus` listeners, which represents all listeners
  //   expect(emitter.listenerCount('events_bus')).to.equal(0);

  //   // initiate a subscription, which should add a listener
  //   const { message } = await TestDataGenerator.generateEventsSubscribe({ author: alice });
  //   const sub = await eventStream.subscribe(alice.did, message, [], messageStore);
  //   expect(emitter.listenerCount('events_bus')).to.equal(1);

  //   // close the subscription, which should remove the listener
  //   await sub.close();
  //   expect(emitter.listenerCount('events_bus')).to.equal(0);
  // });

  // it('should remove listeners when off method is used', async () => {
  //   const alice = await DidKeyResolver.generate();
  //   const emitter = new EventEmitter();
  //   eventStream = new EventStreamEmitter({ emitter });

  //   // initiate a subscription
  //   const { message } = await TestDataGenerator.generateEventsSubscribe();
  //   const sub = await eventStream.subscribe(alice.did, message, [], messageStore);
  //   const messageCid = await Message.getCid(message);

  //   // the listener count for the specific subscription should be at zero
  //   expect(emitter.listenerCount(`${alice.did}_${messageCid}`)).to.equal(0);
  //   const handler = (_:GenericMessage):void => {};
  //   const on1 = sub.on(handler);
  //   const on2 = sub.on(handler);

  //   // after registering two handlers, there should be two listeners
  //   expect(emitter.listenerCount(`${alice.did}_${messageCid}`)).to.equal(2);

  //   // un-register the handlers one by one, checking the listener count after each.
  //   on1.off();
  //   expect(emitter.listenerCount(`${alice.did}_${messageCid}`)).to.equal(1);
  //   on2.off();
  //   expect(emitter.listenerCount(`${alice.did}_${messageCid}`)).to.equal(0);
  //   await sub.close();
  // });
});
