import type { Event } from '../../src/event-log/event-log.js';

import chaiAsPromised from 'chai-as-promised';
import { computeCid } from '../../src/utils/cid.js';
import { EventLogLevel } from '../../src/event-log/event-log-level.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import chai, { expect } from 'chai';

chai.use(chaiAsPromised);

let eventLog: EventLogLevel;

describe('EventLogLevel Tests', () => {
  before(async () => {
    eventLog = new EventLogLevel({ location: 'TEST-EVENTLOG' });
    await eventLog.open();
  });

  beforeEach(async () => {
    await eventLog.clear();
  });

  after(async () => {
    await eventLog.close();
  });

  it('separates events by tenant', async () => {
    const { requester, message } = await TestDataGenerator.generateRecordsWrite();
    const messageCid = await computeCid(message);
    const watermark = await eventLog.append(requester.did, messageCid);

    const { requester: requester2, message: message2 } = await TestDataGenerator.generateRecordsWrite();
    const messageCid2 = await computeCid(message2);
    const watermark2 = await eventLog.append(requester2.did, messageCid2);

    let events = await eventLog.getEvents(requester.did);
    expect(events.length).to.equal(1);
    expect(events[0].watermark).to.equal(watermark);
    expect(events[0].messageCid).to.equal(messageCid);

    events = await eventLog.getEvents(requester2.did);
    expect(events.length).to.equal(1);
    expect(events[0].watermark).to.equal(watermark2);
    expect(events[0].messageCid).to.equal(messageCid2);


  });

  it('returns events in the order that they were appended', async () => {
    const expectedEvents: Array<Event> = [];

    const { requester, message } = await TestDataGenerator.generateRecordsWrite();
    const messageCid = await computeCid(message);
    const watermark = await eventLog.append(requester.did, messageCid);

    expectedEvents.push({ watermark, messageCid });

    for (let i = 0; i < 9; i += 1) {
      const { message } = await TestDataGenerator.generateRecordsWrite({ requester });
      const messageCid = await computeCid(message);
      const watermark = await eventLog.append(requester.did, messageCid);

      expectedEvents.push({ watermark, messageCid });
    }

    const events = await eventLog.getEvents(requester.did);
    expect(events.length).to.equal(expectedEvents.length);

    for (let i = 0; i < 10; i += 1) {
      expect(events[i].watermark).to.equal(expectedEvents[i].watermark);
      expect(events[i].messageCid).to.equal(expectedEvents[i].messageCid);
    }
  });

  describe('getEventsAfter', () => {
    it('gets all events for a tenant if watermark is not provided', async () => {
      const expectedEvents: Event[] = [];

      const { requester, message } = await TestDataGenerator.generateRecordsWrite();
      const messageCid = await computeCid(message);

      const watermark = await eventLog.append(requester.did, messageCid);
      expectedEvents.push({ messageCid, watermark });

      for (let i = 0; i < 9; i += 1) {
        const { message } = await TestDataGenerator.generateRecordsWrite({ requester });
        const messageCid = await computeCid(message);

        const watermark = await eventLog.append(requester.did, messageCid);
        expectedEvents.push({ messageCid, watermark });
      }

      const events = await eventLog.getEvents(requester.did);
      expect(events.length).to.equal(10);

      for (let i = 0; i < events.length; i += 1) {
        expect(events[i].messageCid).to.equal(expectedEvents[i].messageCid);
        expect(events[i].watermark).to.equal(expectedEvents[i].watermark);
      }
    });

    it('gets all events that occured after the watermark provided', async () => {
      const { requester, message } = await TestDataGenerator.generateRecordsWrite();
      const messageCid = await computeCid(message);

      await eventLog.append(requester.did, messageCid);

      const messageCids: string[] = [];
      let testWatermark;

      for (let i = 0; i < 9; i += 1) {
        const { message } = await TestDataGenerator.generateRecordsWrite({ requester });
        const messageCid = await computeCid(message);

        const watermark = await eventLog.append(requester.did, messageCid);

        if (i === 4) {
          testWatermark = watermark;
        }

        if (i > 4) {
          messageCids.push(messageCid);
        }
      }

      const events = await eventLog.getEvents(requester.did, { gt: testWatermark });
      expect(events.length).to.equal(4);

      for (let i = 0; i < events.length; i += 1) {
        expect(events[i].messageCid).to.equal(messageCids[i], `${i}`);
      }
    });
  });

  describe('deleteEventsByCid', () => {
    it('finds and deletes events that whose values match the cids provided', async () => {
      const cids: string[] = [];
      const { requester, message } = await TestDataGenerator.generateRecordsWrite();
      const messageCid = await computeCid(message);

      await eventLog.append(requester.did, messageCid);

      for (let i = 0; i < 9; i += 1) {
        const { message } = await TestDataGenerator.generateRecordsWrite({ requester });
        const messageCid = await computeCid(message);

        await eventLog.append(requester.did, messageCid);
        if (i % 2 === 0) {
          cids.push(messageCid);
        }
      }

      const numEventsDeleted = await eventLog.deleteEventsByCid(requester.did, cids);
      expect(numEventsDeleted).to.equal(cids.length);

      const remainingEvents = await eventLog.getEvents(requester.did);
      expect(remainingEvents.length).to.equal(10 - cids.length);

      const cidSet = new Set(cids);
      for (const event of remainingEvents) {
        if (cidSet.has(event.messageCid)) {
          expect.fail(`${event.messageCid} should not exist`);
        }
      }
    });
  });
});