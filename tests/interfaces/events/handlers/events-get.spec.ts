// import type { EventsGetMessage } from '../../../../src/index.js';

import { EventsGetHandler } from '../../../../src/interfaces/events/handlers/events-get.js';
import { expect } from 'chai';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import { DidKeyResolver, DidResolver, EventLogLevel } from '../../../../src/index.js';

describe('EventsGetHandler.handle()', () => {
  let didResolver: DidResolver;
  let eventLog: EventLogLevel;
  let eventsGetHandler: EventsGetHandler;

  before(async () => {
    didResolver = new DidResolver([new DidKeyResolver()]);
    eventLog = new EventLogLevel({ location: 'TEST-EVENTLOG' });
    eventsGetHandler = new EventsGetHandler(didResolver, eventLog);

    await eventLog.open();
  });

  beforeEach(async () => {
    await eventLog.clear();
  });

  after(async () => {
    await eventLog.close();
  });

  it('returns a 400 if the message provided is invalid', async () => {
    const { requester, message } = await TestDataGenerator.generateRecordsWrite();
    const result = await eventsGetHandler.handle({ tenant: requester.did, message: message as any });

    expect(result.status.code).to.equal(400);
  });
});