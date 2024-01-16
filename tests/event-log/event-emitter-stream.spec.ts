import { EventEmitter } from 'events';

import type { MessageStore } from '../../src/index.js';

import { EventEmitterStream } from '../../src/event-log/event-emitter-stream.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStores } from '../test-stores.js';

import sinon from 'sinon';

import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

chai.use(chaiAsPromised);

describe('EventStreamEmitter', () => {
  let eventStream: EventEmitterStream;
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

  it('should remove listeners when unsubscribe method is used', async () => {
    const emitter = new EventEmitter();
    eventStream = new EventEmitterStream({ emitter });

    // count the `events_bus` listeners, which represents all listeners
    expect(emitter.listenerCount('events')).to.equal(0);

    const sub = await eventStream.subscribe('id', () => {});
    expect(emitter.listenerCount('events')).to.equal(1);

    // close the subscription, which should remove the listener
    await sub.close();
    expect(emitter.listenerCount('events')).to.equal(0);
  });

  xit('logs message when the emitter experiences an error', async () => {
    const emitter = new EventEmitter({ captureRejections: true });
    sinon.stub(emitter, 'emit').rejects('unknown error');
    eventStream = new EventEmitterStream({ emitter });
    await eventStream.open();

    const eventErrorSpy = sinon.spy(eventStream as any, 'eventError');
    await eventStream.subscribe('id', () => {});
    const { message } = await TestDataGenerator.generateRecordsWrite();
    eventStream.emit('alice', message, {});
    expect(eventErrorSpy.callCount).to.equal(1);
  });
});
