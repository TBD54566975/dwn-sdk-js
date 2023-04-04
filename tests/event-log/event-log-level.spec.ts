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

    let events = await eventLog.getEventsAfter(requester.did);
    expect(events.length).to.equal(1);
    expect(events[0].watermark).to.equal(watermark);
    expect(events[0].messageCid).to.equal(messageCid);

    events = await eventLog.getEventsAfter(requester2.did);
    expect(events.length).to.equal(1);
    expect(events[0].watermark).to.equal(watermark2);
    expect(events[0].messageCid).to.equal(messageCid2);


  });
  describe('append tests', () => {
    it('maintains order in which events were appended', async () => {
      const { requester, message } = await TestDataGenerator.generateRecordsWrite();
      const messageCid = await computeCid(message);

      await eventLog.append(requester.did, messageCid);

      const { message: message2 } = await TestDataGenerator.generateRecordsWrite({ requester });
      const messageCid2 = await computeCid(message2);

      await eventLog.append(requester.did, messageCid2);

      const storedValues = [];
      for await (const [_, cid] of eventLog.db.iterator()) {
        storedValues.push(cid);
      }

      expect(storedValues[0]).to.equal(messageCid);
      expect(storedValues[1]).to.equal(messageCid2);
    });
  });

  describe('getEventsAfter', () => {
    it('gets all events for a tenant if watermark is not provided', async () => {
      const expectedEvents = [];

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

      const events = await eventLog.getEventsAfter(requester.did);
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

      const messageCids = [];
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

      const events = await eventLog.getEventsAfter(requester.did, testWatermark);
      expect(events.length).to.equal(4);

      for (let i = 0; i < events.length; i += 1) {
        expect(events[i].messageCid).to.equal(messageCids[i], `${i}`);
      }
    });
  });
});