import type { Event } from '../../src/types/event-log.js';

import chaiAsPromised from 'chai-as-promised';
import { constructRecordsWriteIndexes } from '../../src/handlers/records-write.js';
import { EventLogLevel } from '../../src/event-log/event-log-level.js';
import { Message } from '../../src/core/message.js';
import { normalizeSchemaUrl } from '../../src/utils/url.js';
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
    const { author, message } = await TestDataGenerator.generateRecordsWrite();
    const messageCid = await Message.getCid(message);
    const watermark = await eventLog.append(author.did, messageCid);

    const { author: author2, message: message2 } = await TestDataGenerator.generateRecordsWrite();
    const messageCid2 = await Message.getCid(message2);
    const watermark2 = await eventLog.append(author2.did, messageCid2);

    let events = await eventLog.getEvents(author.did);
    expect(events.length).to.equal(1);
    expect(events[0].watermark).to.equal(watermark);
    expect(events[0].messageCid).to.equal(messageCid);

    events = await eventLog.getEvents(author2.did);
    expect(events.length).to.equal(1);
    expect(events[0].watermark).to.equal(watermark2);
    expect(events[0].messageCid).to.equal(messageCid2);
  });

  it('returns events in the order that they were appended', async () => {
    const expectedEvents: Array<Event> = [];

    const { author, message } = await TestDataGenerator.generateRecordsWrite();
    const messageCid = await Message.getCid(message);
    const watermark = await eventLog.append(author.did, messageCid);

    expectedEvents.push({ watermark, messageCid });

    for (let i = 0; i < 9; i += 1) {
      const { message } = await TestDataGenerator.generateRecordsWrite({ author });
      const messageCid = await Message.getCid(message);
      const watermark = await eventLog.append(author.did, messageCid);

      expectedEvents.push({ watermark, messageCid });
    }

    const events = await eventLog.getEvents(author.did);
    expect(events.length).to.equal(expectedEvents.length);

    for (let i = 0; i < 10; i += 1) {
      expect(events[i].watermark).to.equal(expectedEvents[i].watermark);
      expect(events[i].messageCid).to.equal(expectedEvents[i].messageCid);
    }
  });

  describe('selective sync', () => {
    it('get all events for a tenant that match a filter if watermark is not provided', async () => {
      const author = await TestDataGenerator.generatePersona();
      const expectedSchema1Events: Event[] = [];
      const expectedSchema2Events: Event[] = [];

      for (let i = 0; i < 10; i += 1) {
        const schema = i % 2 === 0 ? 'schema1' : 'schema2';
        const { message, recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author, schema });
        const indexes = await constructRecordsWriteIndexes(recordsWrite, true);
        const messageCid = await Message.getCid(message);
        const watermark = await eventLog.append(author.did, messageCid, indexes);
        if (schema === 'schema1') {
          expectedSchema1Events.push({ messageCid, watermark });
        } else {
          expectedSchema2Events.push({ messageCid, watermark });
        }
      }
      // todo create a query interface that will handle tis
      const schema1Events = await eventLog.query(author.did, [{ schema: normalizeSchemaUrl('schema1') }]);
      expect(schema1Events.length).to.equal(expectedSchema1Events.length);

      for (let i = 0; i < schema1Events.length; i += 1) {
        expect(schema1Events[i].messageCid).to.equal(expectedSchema1Events[i].messageCid);
        expect(schema1Events[i].watermark).to.equal(expectedSchema1Events[i].watermark);
      }
      const schema2Events = await eventLog.query(author.did, [{ schema: normalizeSchemaUrl('schema2') }]);
      expect(schema2Events.length).to.equal(expectedSchema2Events.length);

      for (let i = 0; i < schema2Events.length; i += 1) {
        expect(schema2Events[i].messageCid).to.equal(expectedSchema2Events[i].messageCid);
        expect(schema2Events[i].watermark).to.equal(expectedSchema2Events[i].watermark);
      }
    });

    it('get all events for a tenant that match a filter and occurred after the watermark provided ', async () => {
      const author = await TestDataGenerator.generatePersona();
      const expectedSchema1Events: Event[] = [];
      const expectedSchema2Events: Event[] = [];

      let testWatermark = '';
      for (let i = 0; i < 12; i += 1) {
        const schema = i % 2 === 0 ? 'schema1' : 'schema2';
        const { message, recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author, schema });
        const indexes = await constructRecordsWriteIndexes(recordsWrite, true);
        const messageCid = await Message.getCid(message);
        const watermark = await eventLog.append(author.did, messageCid, indexes);

        if (i === 4) {
          testWatermark = watermark;
        }

        if (i > 4) {
          if (schema === 'schema1') {
            expectedSchema1Events.push({ messageCid, watermark });
          } else {
            expectedSchema2Events.push({ messageCid, watermark });
          }
        }
      }
      // todo create a query interface that will handle tis
      const schema1Events = await eventLog.query(author.did, [{ schema: normalizeSchemaUrl('schema1') }], testWatermark);
      expect(schema1Events.length).to.equal(expectedSchema1Events.length);
      for (let i = 0; i < schema1Events.length; i++) {
        expect(schema1Events[i].messageCid).to.equal(expectedSchema1Events[i].messageCid);
        expect(schema1Events[i].watermark).to.equal(expectedSchema1Events[i].watermark);
      }

      const schema2Events = await eventLog.query(author.did, [{ schema: normalizeSchemaUrl('schema2') }], testWatermark);
      expect(schema2Events.length).to.equal(expectedSchema2Events.length);
      for (let i = 0; i < schema2Events.length; i++) {
        expect(schema2Events[i].messageCid).to.equal(expectedSchema2Events[i].messageCid);
        expect(schema2Events[i].watermark).to.equal(expectedSchema2Events[i].watermark);
      }
    });
  });

  describe('getEventsAfter', () => {
    it('gets all events for a tenant if watermark is not provided', async () => {
      const expectedEvents: Event[] = [];

      const { author, message } = await TestDataGenerator.generateRecordsWrite();
      const messageCid = await Message.getCid(message);

      const watermark = await eventLog.append(author.did, messageCid);
      expectedEvents.push({ messageCid, watermark });

      for (let i = 0; i < 9; i += 1) {
        const { message } = await TestDataGenerator.generateRecordsWrite({ author });
        const messageCid = await Message.getCid(message);

        const watermark = await eventLog.append(author.did, messageCid);
        expectedEvents.push({ messageCid, watermark });
      }

      const events = await eventLog.getEvents(author.did);
      expect(events.length).to.equal(10);

      for (let i = 0; i < events.length; i += 1) {
        expect(events[i].messageCid).to.equal(expectedEvents[i].messageCid);
        expect(events[i].watermark).to.equal(expectedEvents[i].watermark);
      }
    });

    it('gets all events that occurred after the watermark provided', async () => {
      const { author, message } = await TestDataGenerator.generateRecordsWrite();
      const messageCid = await Message.getCid(message);

      await eventLog.append(author.did, messageCid);

      const messageCids: string[] = [];
      let testWatermark = '';

      for (let i = 0; i < 9; i += 1) {
        const { message } = await TestDataGenerator.generateRecordsWrite({ author });
        const messageCid = await Message.getCid(message);

        const watermark = await eventLog.append(author.did, messageCid);

        if (i === 4) {
          testWatermark = watermark;
        }

        if (i > 4) {
          messageCids.push(messageCid);
        }
      }

      const events = await eventLog.getEvents(author.did, { gt: testWatermark });
      expect(events.length).to.equal(4);

      for (let i = 0; i < events.length; i += 1) {
        expect(events[i].messageCid).to.equal(messageCids[i], `${i}`);
      }
    });
  });

  describe('deleteEventsByCid', () => {
    it('finds and deletes events that whose values match the cids provided', async () => {
      const cids: string[] = [];
      const { author, message } = await TestDataGenerator.generateRecordsWrite();
      const messageCid = await Message.getCid(message);

      await eventLog.append(author.did, messageCid);

      for (let i = 0; i < 9; i += 1) {
        const { message } = await TestDataGenerator.generateRecordsWrite({ author });
        const messageCid = await Message.getCid(message);

        await eventLog.append(author.did, messageCid);
        if (i % 2 === 0) {
          cids.push(messageCid);
        }
      }

      const numEventsDeleted = await eventLog.deleteEventsByCid(author.did, cids);
      expect(numEventsDeleted).to.equal(cids.length);

      const remainingEvents = await eventLog.getEvents(author.did);
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