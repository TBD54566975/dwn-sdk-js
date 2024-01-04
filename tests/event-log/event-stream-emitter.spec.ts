import type { GenericMessage, MessageStore } from '../../src/index.js';

import EventEmitter from 'events';
import { EventStreamEmitter } from '../../src/event-log/event-stream.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { DidKeyResolver, Message } from '../../src/index.js';
import { DidResolver, MessageStoreLevel } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

chai.use(chaiAsPromised);

describe('EventStreamEmitter', () => {
  let eventStream: EventStreamEmitter;
  let didResolver: DidResolver;
  let messageStore: MessageStore;

  before(() => {
    didResolver = new DidResolver();
    messageStore = new MessageStoreLevel({
      blockstoreLocation : 'TEST-MESSAGESTORE',
      indexLocation      : 'TEST-INDEX'
    });
  });

  beforeEach(async () => {
    messageStore.clear();
  });

  after(async () => {
    // Clean up after each test by closing and clearing the event stream
    await messageStore.close();
    await eventStream.close();
  });

  it('should remove listeners when unsubscribe method is used', async () => {
    const alice = await DidKeyResolver.generate();

    const emitter = new EventEmitter();
    eventStream = new EventStreamEmitter({ emitter, messageStore, didResolver });

    // count the `events_bus` listeners, which represents all listeners
    expect(emitter.listenerCount('events_bus')).to.equal(0);

    // initiate a subscription, which should add a listener
    const { message } = await TestDataGenerator.generateRecordsSubscribe({ author: alice });
    const sub = await eventStream.subscribe(alice.did, message, []);
    expect(emitter.listenerCount('events_bus')).to.equal(1);

    // close the subscription, which should remove the listener
    await sub.close();
    expect(emitter.listenerCount('events_bus')).to.equal(0);
  });

  it('should remove listeners when off method is used', async () => {
    const alice = await DidKeyResolver.generate();
    const emitter = new EventEmitter();
    eventStream = new EventStreamEmitter({ emitter, messageStore, didResolver });

    // initiate a subscription
    const { message } = await TestDataGenerator.generateRecordsSubscribe();
    const sub = await eventStream.subscribe(alice.did, message, []);
    const messageCid = await Message.getCid(message);

    // the listener count for the specific subscription should be at zero
    expect(emitter.listenerCount(`${alice.did}_${messageCid}`)).to.equal(0);
    const handler = (_:GenericMessage):void => {};
    const on1 = sub.on(handler);
    const on2 = sub.on(handler);

    // after registering two handlers, there should be two listeners
    expect(emitter.listenerCount(`${alice.did}_${messageCid}`)).to.equal(2);

    // un-register the handlers one by one, checking the listener count after each.
    on1.off();
    expect(emitter.listenerCount(`${alice.did}_${messageCid}`)).to.equal(1);
    on2.off();
    expect(emitter.listenerCount(`${alice.did}_${messageCid}`)).to.equal(0);
    await sub.close();
  });
});
