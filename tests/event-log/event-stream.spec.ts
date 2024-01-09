import type { EventStream, MessageStore } from '../../src/index.js';

import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);

describe('EventStream', () => {
  let eventStream: EventStream;
  let messageStore: MessageStore;

  before(() => {
    ({ messageStore } = TestStores.get());
    eventStream = TestEventStream.get();
  });

  beforeEach(async () => {
    messageStore.clear();
  });

  after(async () => {
    // Clean up after each test by closing and clearing the event stream
    await messageStore.close();
    await eventStream.close();
  });
});
