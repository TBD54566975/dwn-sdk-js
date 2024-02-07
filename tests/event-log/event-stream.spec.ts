import type { EventStream } from '../../src/index.js';
import type { KeyValues } from '../../src/types/query-types.js';
import type { MessageEvent } from '../../src/types/subscriptions.js';

import { TestEventStream } from '../test-event-stream.js';
import { Message, TestDataGenerator, Time } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

chai.use(chaiAsPromised);

describe('EventStream', () => {
  // saving the original `console.error` function to re-assign after tests complete
  const originalConsoleErrorFunction = console.error;
  let eventStream: EventStream;

  before(async () => {
    eventStream = TestEventStream.get();
    await eventStream.open();

    // do not print the console error statements from the emitter error
    console.error = (_):void => { };
  });

  after(async () => {
    console.error = originalConsoleErrorFunction;
    // Clean up after each test by closing and clearing the event stream
    await eventStream.close();
  });

  it('emits all messages to each subscriptions', async () => {
    const messageCids1: string[] = [];
    const handler1 = async (_tenant: string, event: MessageEvent, _indexes: KeyValues): Promise<void> => {
      const { message } = event;
      const messageCid = await Message.getCid(message);
      messageCids1.push(messageCid);
    };

    const messageCids2: string[] = [];
    const handler2 = async (_tenant: string, event: MessageEvent, _indexes: KeyValues): Promise<void> => {
      const { message } = event;
      const messageCid = await Message.getCid(message);
      messageCids2.push(messageCid);
    };

    const subscription1 = await eventStream.subscribe('sub-1', handler1);
    const subscription2 = await eventStream.subscribe('sub-2', handler2);

    const message1 = await TestDataGenerator.generateRecordsWrite({});
    const message1Cid = await Message.getCid(message1.message);
    eventStream.emit('did:alice', { message: message1.message }, {});
    const message2 = await TestDataGenerator.generateRecordsWrite({});
    const message2Cid = await Message.getCid(message2.message);
    eventStream.emit('did:alice', { message: message2.message }, {});
    const message3 = await TestDataGenerator.generateRecordsWrite({});
    const message3Cid = await Message.getCid(message3.message);
    eventStream.emit('did:alice', { message: message3.message }, {});

    await subscription1.close();
    await subscription2.close();

    await Time.minimalSleep();

    expect(messageCids1).to.have.members([ message1Cid, message2Cid, message3Cid ]);
    expect(messageCids2).to.have.members([ message1Cid, message2Cid, message3Cid ]);
  });

  it('does not emit messages if subscription is closed', async () => {
    const messageCids: string[] = [];
    const handler = async (_tenant: string, event: MessageEvent, _indexes: KeyValues): Promise<void> => {
      const { message } = event;
      const messageCid = await Message.getCid(message);
      messageCids.push(messageCid);
    };
    const subscription = await eventStream.subscribe('sub-1', handler);

    const message1 = await TestDataGenerator.generateRecordsWrite({});
    const message1Cid = await Message.getCid(message1.message);
    eventStream.emit('did:alice', { message: message1.message }, {});
    await subscription.close();

    const message2 = await TestDataGenerator.generateRecordsWrite({});
    eventStream.emit('did:alice', { message: message2.message }, {});

    await Time.minimalSleep();

    expect(messageCids).to.have.members([ message1Cid ]);
  });

  it('does not emit messages if event stream is closed', async () => {
    const messageCids: string[] = [];
    const handler = async (_tenant: string, event: MessageEvent, _indexes: KeyValues): Promise<void> => {
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

    await subscription.close();

    await Time.minimalSleep();
    expect(messageCids).to.have.length(0);
  });
});
