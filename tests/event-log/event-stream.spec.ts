import type { KeyValues } from '../../src/types/query-types.js';
import type { EventStream, GenericMessage } from '../../src/index.js';

import { TestEventStream } from '../test-event-stream.js';
import { Message, TestDataGenerator, Time } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

chai.use(chaiAsPromised);

describe('EventStream', () => {
  let eventStream: EventStream;

  before(async () => {
    eventStream = TestEventStream.get();
    await eventStream.open();
  });

  after(async () => {
    // Clean up after each test by closing and clearing the event stream
    await eventStream.close();
  });

  it('emits all messages to each subscriptions', async () => {
    const messageCids: string[] = [];
    const handler = async (_tenant: string, message: GenericMessage, _indexes: KeyValues): Promise<void> => {
      const messageCid = await Message.getCid(message);
      messageCids.push(messageCid);
    };
    const subcription = await eventStream.subscribe('sub-1', handler);

    const message1 = await TestDataGenerator.generateRecordsWrite({});
    const message1Cid = await Message.getCid(message1.message);
    eventStream.emit('did:alice', message1.message, {});
    const message2 = await TestDataGenerator.generateRecordsWrite({});
    const message2Cid = await Message.getCid(message2.message);
    eventStream.emit('did:alice', message2.message, {});
    const message3 = await TestDataGenerator.generateRecordsWrite({});
    const message3Cid = await Message.getCid(message3.message);
    eventStream.emit('did:alice', message3.message, {});

    await subcription.close();

    await Time.minimalSleep();

    expect(messageCids).to.have.members([ message1Cid, message2Cid, message3Cid ]);
  });

  it('does not emit messages if subscription is closed', async () => {
    const messageCids: string[] = [];
    const handler = async (_tenant: string, message: GenericMessage, _indexes: KeyValues): Promise<void> => {
      const messageCid = await Message.getCid(message);
      messageCids.push(messageCid);
    };
    const subcription = await eventStream.subscribe('sub-1', handler);

    const message1 = await TestDataGenerator.generateRecordsWrite({});
    const message1Cid = await Message.getCid(message1.message);
    eventStream.emit('did:alice', message1.message, {});
    await subcription.close();

    const message2 = await TestDataGenerator.generateRecordsWrite({});
    eventStream.emit('did:alice', message2.message, {});

    await Time.minimalSleep();

    expect(messageCids).to.have.members([ message1Cid ]);
  });

  it('does not emit messages if emitter is closed', async () => {
    const messageCids: string[] = [];
    const handler = async (_tenant: string, message: GenericMessage, _indexes: KeyValues): Promise<void> => {
      const messageCid = await Message.getCid(message);
      messageCids.push(messageCid);
    };
    const subcription = await eventStream.subscribe('sub-1', handler);

    // close eventEmitter
    await eventStream.close();

    const message1 = await TestDataGenerator.generateRecordsWrite({});
    eventStream.emit('did:alice', message1.message, {});
    const message2 = await TestDataGenerator.generateRecordsWrite({});
    eventStream.emit('did:alice', message2.message, {});

    await subcription.close();

    await Time.minimalSleep();
    expect(messageCids).to.have.length(0);
  });
});
