import type { Event } from '../../src/types/event-log.js';

import chaiAsPromised from 'chai-as-promised';
import { EventLogLevel } from '../../src/event-log/event-log-level.js';
import { Message } from '../../src/core/message.js';
import { normalizeSchemaUrl } from '../../src/utils/url.js';
import { RecordsWriteHandler } from '../../src/handlers/records-write.js';
import { SortOrder } from '../../src/index.js';
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

  describe('query', () => {
    it('returns filtered events in the order that they were appended', async () => {
      const expectedEvents: Array<Event> = [];

      const { author, message, recordsWrite } = await TestDataGenerator.generateRecordsWrite({ schema: 'schema1' });
      const messageCid = await Message.getCid(message);
      const indexes = await RecordsWriteHandler.constructIndexes(recordsWrite, true);
      const watermark = await eventLog.append(author.did, messageCid, indexes);

      expectedEvents.push({ watermark, messageCid });

      for (let i = 0; i < 5; i += 1) {
        const { message, recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author, schema: 'schema1' });
        const messageCid = await Message.getCid(message);
        const indexes = await RecordsWriteHandler.constructIndexes(recordsWrite, true);
        const watermark = await eventLog.append(author.did, messageCid, indexes);

        expectedEvents.push({ watermark, messageCid });
      }

      // insert a record that will not show up in the filtered query.
      // not inserted into expected events.
      const { message: message2, recordsWrite: recordsWrite2 } = await TestDataGenerator.generateRecordsWrite({ author });
      const message2Cid = await Message.getCid(message2);
      const message2Indexes = await RecordsWriteHandler.constructIndexes(recordsWrite2, true);
      await eventLog.append(author.did, message2Cid, message2Indexes);

      for (let i = 0; i < 5; i += 1) {
        const { message, recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author, schema: 'schema1' });
        const messageCid = await Message.getCid(message);
        const indexes = await RecordsWriteHandler.constructIndexes(recordsWrite, true);
        const watermark = await eventLog.append(author.did, messageCid, indexes);

        expectedEvents.push({ watermark, messageCid });
      }

      const events = await eventLog.queryEvents(author.did, [{ filter: { schema: normalizeSchemaUrl('schema1') }, sort: 'watermark', sortDirection: SortOrder.Ascending }]);
      expect(events.length).to.equal(expectedEvents.length);

      for (let i = 0; i < expectedEvents.length; i += 1) {
        expect(events[i].watermark).to.equal(expectedEvents[i].watermark);
        expect(events[i].messageCid).to.equal(expectedEvents[i].messageCid);
      }
    });

    it('returns filtered events after watermark', async () => {
      const expectedEvents: Array<Event> = [];
      let testWatermark;

      const { author, message, recordsWrite } = await TestDataGenerator.generateRecordsWrite({ schema: 'schema1' });
      const messageCid = await Message.getCid(message);
      const indexes = await RecordsWriteHandler.constructIndexes(recordsWrite, true);
      await eventLog.append(author.did, messageCid, indexes);

      for (let i = 0; i < 5; i += 1) {
        const { message, recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author, schema: 'schema1' });
        const messageCid = await Message.getCid(message);
        const indexes = await RecordsWriteHandler.constructIndexes(recordsWrite, true);
        const watermark = await eventLog.append(author.did, messageCid, indexes);

        if (i === 3) {
          testWatermark = watermark;
        }

        if (i > 3) {
          expectedEvents.push({ watermark, messageCid });
        }
      }

      // insert a record that will not show up in the filtered query.
      // not inserted into expected events.
      const { message: message2, recordsWrite: recordsWrite2 } = await TestDataGenerator.generateRecordsWrite({ author });
      const message2Cid = await Message.getCid(message2);
      const message2Indexes = await RecordsWriteHandler.constructIndexes(recordsWrite2, true);
      await eventLog.append(author.did, message2Cid, message2Indexes);

      for (let i = 0; i < 5; i += 1) {
        const { message, recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author, schema: 'schema1' });
        const messageCid = await Message.getCid(message);
        const indexes = await RecordsWriteHandler.constructIndexes(recordsWrite, true);
        const watermark = await eventLog.append(author.did, messageCid, indexes);

        expectedEvents.push({ watermark, messageCid });
      }

      const events = await eventLog.queryEvents(author.did, [{ filter: { schema: normalizeSchemaUrl('schema1') }, cursor: testWatermark, sort: 'watermark', sortDirection: SortOrder.Ascending }]);
      expect(events.length).to.equal(expectedEvents.length);

      for (let i = 0; i < expectedEvents.length; i += 1) {
        expect(events[i].watermark).to.equal(expectedEvents[i].watermark);
        expect(events[i].messageCid).to.equal(expectedEvents[i].messageCid);
      }
    });
  });
});