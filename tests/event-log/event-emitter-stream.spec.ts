import type { EventMessage } from '../../src/types/subscriptions.js';
import type { KeyValues } from '../../src/types/query-types.js';
import type { MessageStore } from '../../src/index.js';

import { EventEmitterStream } from '../../src/event-log/event-emitter-stream.js';
import { TestStores } from '../test-stores.js';
import { Message, TestDataGenerator, Time } from '../../src/index.js';

import sinon from 'sinon';

import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

chai.use(chaiAsPromised);

describe('EventEmitterStream', () => {
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
    sinon.restore();
  });

  it('should remove listeners when `close` method is used', async () => {
    const eventStream = new EventEmitterStream();
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
    const testHandler = {
      errorHandler: (_:any):void => {},
    };
    const eventErrorSpy = sinon.spy(testHandler, 'errorHandler');

    const eventStream = new EventEmitterStream({ errorHandler: testHandler.errorHandler });
    const emitter = eventStream['eventEmitter'];
    emitter.emit('error', new Error('random error'));
    expect(eventErrorSpy.callCount).to.equal(1);
  });

  it('does not emit messages if event stream is closed', async () => {
    const testHandler = {
      errorHandler: (_:any):void => {},
    };
    const eventErrorSpy = sinon.spy(testHandler, 'errorHandler');

    const eventStream = new EventEmitterStream({ errorHandler: testHandler.errorHandler });

    const messageCids: string[] = [];
    const handler = async (_tenant: string, event: EventMessage, _indexes: KeyValues): Promise<void> => {
      const { message } = event;
      const messageCid = await Message.getCid(message);
      messageCids.push(messageCid);
    };
    const subscription = await eventStream.subscribe('sub-1', handler);

    // close eventStream
    await eventStream.close();

    const message1 = await TestDataGenerator.generateRecordsWrite({});
    eventStream.emit('did:alice', { message: message1.message }, {});
    const message2 = await TestDataGenerator.generateRecordsWrite({});
    eventStream.emit('did:alice', { message: message2.message }, {});

    expect(eventErrorSpy.callCount).to.equal(2);
    await subscription.close();

    await Time.minimalSleep();
    expect(messageCids).to.have.length(0);
  });

  it('sets max listeners to 0 which represents infinity', async () => {
    const eventStreamOne = new EventEmitterStream();
    const emitterOne = eventStreamOne['eventEmitter'];
    expect(emitterOne.getMaxListeners()).to.equal(0);
  });
});
