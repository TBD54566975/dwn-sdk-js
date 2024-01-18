import type { MessageStore } from '../../src/index.js';

import { EventEmitterStream } from '../../src/event-log/event-emitter-stream.js';
import { TestStores } from '../test-stores.js';

import sinon from 'sinon';

import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

chai.use(chaiAsPromised);

describe('EventEmitterStream', () => {
  // saving the original `console.error` function to re-assign after tests complete
  const originalConsoleErrorFunction = console.error;
  let eventStream: EventEmitterStream;
  let messageStore: MessageStore;

  before(() => {
    ({ messageStore } = TestStores.get());

    // do not print the console error statements from the emitter error
    console.error = (_):void => { };
  });

  beforeEach(async () => {
    messageStore.clear();
  });

  after(async () => {
    console.error = originalConsoleErrorFunction;
    // Clean up after each test by closing and clearing the event stream
    await messageStore.close();
    await eventStream.close();
  });

  it('should remove listeners when `close` method is used', async () => {
    eventStream = new EventEmitterStream();
    const emitter = eventStream['eventEmitter'];

    // count the `events` listeners, which represents all listeners
    expect(emitter.listenerCount('events')).to.equal(0);

    const sub = await eventStream.subscribe('id', () => {});
    expect(emitter.listenerCount('events')).to.equal(1);

    // close the subscription, which should remove the listener
    await sub.close();
    expect(emitter.listenerCount('events')).to.equal(0);
  });

  it('logs message when the emitter experiences an error', async () => {
    const eventErrorSpy = sinon.spy(EventEmitterStream.prototype as any, 'eventError');
    eventStream = new EventEmitterStream();
    const emitter = eventStream['eventEmitter'];
    emitter.emit('error', new Error('random error'));
    expect(eventErrorSpy.callCount).to.equal(1);
  });
});
