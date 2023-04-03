import chaiAsPromised from 'chai-as-promised';
import { computeCid } from '../../src/utils/cid.js';
import { EventLogLevel } from '../../src/event-log/event-log-level.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import chai, { expect } from 'chai';

chai.use(chaiAsPromised);

let eventLog: EventLogLevel;

describe('EventLogLevel Tests', () => {
  describe('append tests', () => {
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

    it('appends a tenant namespaced entry into leveldb', async () => {
      const { requester, message } = await TestDataGenerator.generateRecordsWrite();
      const messageCid = await computeCid(message);

      const watermark = await eventLog.append(requester.did, messageCid);

      for await (const [key, value] of eventLog.db.iterator()) {
        expect(key).to.include(watermark);
        expect(value).to.equal(messageCid);
      }
    });

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

    it('gets all events for a tenant if watermark is not provided', async () => {
      const messageCids = [];

      const { requester, message } = await TestDataGenerator.generateRecordsWrite();
      const messageCid = await computeCid(message);
      messageCids.push(messageCid);

      await eventLog.append(requester.did, messageCid);

      for (let i = 0; i < 9; i += 1) {
        const { message } = await TestDataGenerator.generateRecordsWrite({ requester });
        const messageCid = await computeCid(message);
        messageCids.push(messageCid);

        await eventLog.append(requester.did, messageCid);
      }

      const events = await eventLog.getEventsAfter(requester.did);
      expect(events.length).to.equal(10);

      for (let i = 0; i < events.length; i += 1) {
        expect(events[i].messageCid).to.equal(messageCids[i]);
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