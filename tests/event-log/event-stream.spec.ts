import type { EventStream } from '../../src/index.js';
import type { KeyValues } from '../../src/types/query-types.js';
import type { MessageEvent } from '../../src/types/subscriptions.js';

import { Poller } from '../utils/poller.js';
import { TestEventStream } from '../test-event-stream.js';
import { Message, TestDataGenerator } from '../../src/index.js';

import sinon from 'sinon';

import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

chai.use(chaiAsPromised);

// NOTE: We use `TestTimingUtils.pollUntilSuccessOrTimeout` to poll for the expected results.
// In some cases, the EventStream is a coordinated pub/sub system and the messages/events are emitted over the network
// this means that the messages are not processed immediately and we need to wait for the messages to be processed
// before we can assert the results. The `pollUntilSuccessOrTimeout` function is a utility function that will poll until the expected results are met.

// It is also important to note that in some cases where we are testing a negative case (the message not arriving at the subscriber)
// we add an alternate subscription to await results within to give the EventStream ample time to process the message.
// Additionally in some of these cases the order in which messages are sent to be processed or checked may matter, and they are noted as such.

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

  beforeEach(() => {
    sinon.restore();
  });

  after(async () => {
    sinon.restore();
    console.error = originalConsoleErrorFunction;
    // Clean up after each test by closing and clearing the event stream
    await eventStream.close();
  });

  it('emits all messages to each subscriptions', async () => {
    // Scenario: We create 2 separate subscriptions that listen to all messages
    // and we emit 3 messages. We expect both subscriptions to receive all 3 messages.

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

    const subscription1 = await eventStream.subscribe('did:alice', 'sub-1', handler1);
    const subscription2 = await eventStream.subscribe('did:alice', 'sub-2', handler2);

    const message1 = await TestDataGenerator.generateRecordsWrite({});
    const message1Cid = await Message.getCid(message1.message);
    eventStream.emit('did:alice', { message: message1.message }, {});
    const message2 = await TestDataGenerator.generateRecordsWrite({});
    const message2Cid = await Message.getCid(message2.message);
    eventStream.emit('did:alice', { message: message2.message }, {});
    const message3 = await TestDataGenerator.generateRecordsWrite({});
    const message3Cid = await Message.getCid(message3.message);
    eventStream.emit('did:alice', { message: message3.message }, {});

    // Use the TimingUtils to poll until the expected results are met
    await Poller.pollUntilSuccessOrTimeout(async () => {
      expect(messageCids1).to.have.members([ message1Cid, message2Cid, message3Cid ]);
      expect(messageCids2).to.have.members([ message1Cid, message2Cid, message3Cid ]);
    });

    await subscription1.close();
    await subscription2.close();
  });

  it('does not receive messages if subscription is closed', async () => {
    // Scenario: We create two subscriptions that listen to all messages.
    //           The reason we create two is in order to allow for a negative test case.
    //           We send a message, validate that both handlers processed the message
    //           We then close one of the subscriptions, and send another message.
    //           Now we validate that only the handler of the subscription that is still open received the message.

    const sub1MessageCids: string[] = [];
    const handler1 = async (_tenant: string, event: MessageEvent, _indexes: KeyValues): Promise<void> => {
      const { message } = event;
      const messageCid = await Message.getCid(message);
      sub1MessageCids.push(messageCid);
    };

    const sub2MessageCids: string[] = [];
    const handler2 = async (_tenant: string, event: MessageEvent, _indexes: KeyValues): Promise<void> => {
      const { message } = event;
      const messageCid = await Message.getCid(message);
      sub2MessageCids.push(messageCid);
    };

    const subscription1 = await eventStream.subscribe('did:alice', 'sub-1', handler1);
    const subscription2 = await eventStream.subscribe('did:alice', 'sub-2', handler2);

    const message1 = await TestDataGenerator.generateRecordsWrite({});
    const message1Cid = await Message.getCid(message1.message);
    eventStream.emit('did:alice', { message: message1.message }, {});

    // Use the TimingUtils to poll until the expected results are met
    await Poller.pollUntilSuccessOrTimeout(async () => {
      expect(sub1MessageCids).to.have.length(1);
      expect(sub1MessageCids).to.have.members([ message1Cid ]);

      expect(sub2MessageCids).to.have.length(1);
      expect(sub2MessageCids).to.have.members([ message1Cid ]);
    });

    await subscription1.close(); // close subscription 1

    const message2 = await TestDataGenerator.generateRecordsWrite({});
    const message2Cid = await Message.getCid(message2.message);
    eventStream.emit('did:alice', { message: message2.message }, {});

    // Use the TimingUtils to poll until the expected results are met
    await Poller.pollUntilSuccessOrTimeout(async() => {
      // subscription 2 should have received the message
      expect(sub2MessageCids.length).to.equal(2);
      expect(sub2MessageCids).to.have.members([ message1Cid, message2Cid]);

      // subscription 1 should not have received the message
      expect(sub1MessageCids).to.have.length(1);
      expect(sub1MessageCids).to.have.members([ message1Cid ]);
    });

    await subscription2.close();
  });
});
