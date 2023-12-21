import type { GenericMessage, MessageStore } from '../../src/index.js';

import EventEmitter from 'events';
import { EventStreamEmitter } from '../../src/event-log/event-stream.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { DidKeyResolver, Message } from '../../src/index.js';
import { DidResolver, MessageStoreLevel } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

chai.use(chaiAsPromised);

describe('Event Stream Tests', () => {
  let eventStream: EventStreamEmitter;
  let didResolver: DidResolver;
  let messageStore: MessageStore;

  before(() => {
    didResolver = new DidResolver();
    messageStore = new MessageStoreLevel({
      blockstoreLocation : 'TEST-MESSAGESTORE',
      indexLocation      : 'TEST-INDEX'
    });
    // Create a new instance of EventStream before each test
    eventStream = new EventStreamEmitter({ didResolver, messageStore });
  });

  beforeEach(async () => {
    messageStore.clear();
  });

  after(async () => {
    // Clean up after each test by closing and clearing the event stream
    await messageStore.close();
    await eventStream.close();
  });

  xit('test add callback', async () => {
  });

  xit('test bad message', async () => {
  });

  xit('should throw an error when adding events to a closed stream', async () => {
  });

  xit('should handle concurrent event sending', async () => {
  });

  xit('test emitter chaining', async () => {
  });

  it('should remove listeners when unsubscribe method is used', async () => {
    const alice = await DidKeyResolver.generate();
    const emitter = new EventEmitter();
    const eventEmitter = new EventStreamEmitter({ emitter, messageStore, didResolver });
    expect(emitter.listenerCount('events_bus')).to.equal(0);

    const { message } = await TestDataGenerator.generateRecordsSubscribe({ author: alice });
    const sub = await eventEmitter.subscribe(alice.did, message, []);
    expect(emitter.listenerCount('events_bus')).to.equal(1);

    await sub.close();
    expect(emitter.listenerCount('events_bus')).to.equal(0);
  });

  it('should remove listeners when off method is used', async () => {
    const alice = await DidKeyResolver.generate();
    const emitter = new EventEmitter();
    const eventEmitter = new EventStreamEmitter({ emitter, messageStore, didResolver });
    const { message } = await TestDataGenerator.generateRecordsSubscribe();
    const sub = await eventEmitter.subscribe(alice.did, message, []);
    const messageCid = await Message.getCid(message);
    expect(emitter.listenerCount(`${alice.did}_${messageCid}`)).to.equal(0);
    const handler = (_:GenericMessage):void => {};
    const on1 = sub.on(handler);
    const on2 = sub.on(handler);
    expect(emitter.listenerCount(`${alice.did}_${messageCid}`)).to.equal(2);

    on1.off();
    expect(emitter.listenerCount(`${alice.did}_${messageCid}`)).to.equal(1);
    on2.off();
    expect(emitter.listenerCount(`${alice.did}_${messageCid}`)).to.equal(0);
    await sub.close();
  });
});
