import type { EventLog } from '../../src/types/event-log.js';

import { Message } from '../../src/core/message.js';
import { normalizeSchemaUrl } from '../../src/utils/url.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStores } from '../test-stores.js';

import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

chai.use(chaiAsPromised);
export function testEventLog(): void {
  describe('EventLog Tests', () => {
    let eventLog: EventLog;

    before(async () => {
      const stores = TestStores.get();
      eventLog = stores.eventLog;
      await eventLog.open();
    });

    beforeEach(async () => {
      await eventLog.clear();
    });

    after(async () => {
      await eventLog.close();
    });

    it('separates events by tenant', async () => {
      const { author, message, recordsWrite } = await TestDataGenerator.generateRecordsWrite();
      const message1Index = await recordsWrite.constructIndexes(true);
      const messageCid = await Message.getCid(message);
      await eventLog.append(author.did, messageCid, message1Index);

      const { author: author2, message: message2, recordsWrite: recordsWrite2 } = await TestDataGenerator.generateRecordsWrite();
      const message2Index = await recordsWrite2.constructIndexes(true);
      const messageCid2 = await Message.getCid(message2);
      await eventLog.append(author2.did, messageCid2, message2Index);

      let { events } = await eventLog.getEvents(author.did);
      expect(events.length).to.equal(1);
      expect(events[0]).to.equal(messageCid);

      ({ events } = await eventLog.getEvents(author2.did));
      expect(events.length).to.equal(1);
      expect(events[0]).to.equal(messageCid2);
    });

    it('returns events in the order that they were appended', async () => {
      const expectedMessages: Array<string> = [];

      const { author, message, recordsWrite } = await TestDataGenerator.generateRecordsWrite();
      const messageCid = await Message.getCid(message);
      const messageIndex = await recordsWrite.constructIndexes(true);
      await eventLog.append(author.did, messageCid, messageIndex);

      expectedMessages.push(messageCid);

      for (let i = 0; i < 9; i += 1) {
        const { message, recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author });
        const messageCid = await Message.getCid(message);
        const index = await recordsWrite.constructIndexes(true);
        await eventLog.append(author.did, messageCid, index);

        expectedMessages.push(messageCid);
      }

      const { events } = await eventLog.getEvents(author.did);
      expect(events.length).to.equal(expectedMessages.length);

      for (let i = 0; i < 10; i += 1) {
        expect(events[i]).to.equal(expectedMessages[i]);
      }
    });

    describe('getEventsAfter', () => {
      it('gets all events for a tenant if a cursor is not provided', async () => {
        const expectedMessages: string[] = [];

        const { author, message, recordsWrite } = await TestDataGenerator.generateRecordsWrite();
        const messageCid = await Message.getCid(message);
        const messageIndex = await recordsWrite.constructIndexes(true);
        await eventLog.append(author.did, messageCid, messageIndex);
        expectedMessages.push(messageCid);

        for (let i = 0; i < 9; i += 1) {
          const { message, recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author });
          const messageCid = await Message.getCid(message);
          const index = await recordsWrite.constructIndexes(true);

          await eventLog.append(author.did, messageCid, index);
          expectedMessages.push(messageCid);
        }

        const { events } = await eventLog.getEvents(author.did);
        expect(events.length).to.equal(10);

        for (let i = 0; i < events.length; i += 1) {
          expect(events[i]).to.equal(expectedMessages[i]);
        }
      });

      it('gets all events that occurred after the cursor provided', async () => {
        const author = await TestDataGenerator.generateDidKeyPersona();

        // create an initial record to and, issue a getEvents and grab the cursor
        const { message, recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author });
        const messageCid = await Message.getCid(message);
        const index = await recordsWrite.constructIndexes(true);

        await eventLog.append(author.did, messageCid, index);
        const { events: cursorEvents, cursor } = await eventLog.getEvents(author.did);
        expect(cursorEvents.length).to.equal(1);
        expect(cursor).to.not.be.undefined;
        expect(cursorEvents[0]).to.equal(messageCid);

        // add more messages
        const expectedMessages: string[] = [];
        for (let i = 0; i < 5; i += 1) {
          const { message, recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author });
          const messageCid = await Message.getCid(message);
          const index = await recordsWrite.constructIndexes(true);

          await eventLog.append(author.did, messageCid, index);
          expectedMessages.push(messageCid);
        }

        const { events } = await eventLog.getEvents(author.did, cursor);
        expect(events.length).to.equal(5);

        for (let i = 0; i < events.length; i += 1) {
          expect(events[i]).to.equal(expectedMessages[i], `${i}`);
        }
      });
    });

    describe('deleteEventsByCid', () => {
      it('finds and deletes events that whose values match the cids provided', async () => {
        const { author, message, recordsWrite } = await TestDataGenerator.generateRecordsWrite();
        const messageCid = await Message.getCid(message);
        const index = await recordsWrite.constructIndexes(true);

        await eventLog.append(author.did, messageCid, index);

        const deleteMessages: string[] = [];
        for (let i = 0; i < 9; i += 1) {
          const { message, recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author });
          const messageCid = await Message.getCid(message);
          const index = await recordsWrite.constructIndexes(true);

          await eventLog.append(author.did, messageCid, index);
          if (i % 2 === 0) {
            deleteMessages.push(messageCid);
          }
        }

        await eventLog.deleteEventsByCid(author.did, deleteMessages);
        const { events: remainingEvents } = await eventLog.getEvents(author.did);
        expect(remainingEvents.length).to.equal(10 - deleteMessages.length);
        expect(remainingEvents).to.not.include.members(deleteMessages);
      });

      it('skips if cid is invalid', async () => {
        const cids: string[] = [];
        const { author, message, recordsWrite } = await TestDataGenerator.generateRecordsWrite();
        const messageCid = await Message.getCid(message);
        const index = await recordsWrite.constructIndexes(true);

        await eventLog.append(author.did, messageCid, index);
        cids.push(messageCid);

        for (let i = 0; i < 3; i += 1) {
          const { message, recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author });
          const messageCid = await Message.getCid(message);
          const index = await recordsWrite.constructIndexes(true);

          await eventLog.append(author.did, messageCid, index);
          cids.push(messageCid);
        }

        // does not error and deletes all messages
        await eventLog.deleteEventsByCid(author.did, [...cids, 'someInvalidCid' ]);

        const { events: remainingEvents } = await eventLog.getEvents(author.did);
        expect(remainingEvents.length).to.equal(0);
      });
    });

    describe('query', () => {
      it('returns filtered events in the order that they were appended', async () => {
        const expectedMessages: Array<string> = [];

        const { author, message, recordsWrite } = await TestDataGenerator.generateRecordsWrite({ schema: 'schema1' });
        const messageCid = await Message.getCid(message);
        const indexes = await recordsWrite.constructIndexes(true);
        await eventLog.append(author.did, messageCid, indexes);

        expectedMessages.push(messageCid);

        for (let i = 0; i < 5; i += 1) {
          const { message, recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author, schema: 'schema1' });
          const messageCid = await Message.getCid(message);
          const indexes = await recordsWrite.constructIndexes(true);
          await eventLog.append(author.did, messageCid, indexes);

          expectedMessages.push(messageCid);
        }

        // insert a record that will not show up in the filtered query.
        // not inserted into expected events.
        const { message: message2, recordsWrite: recordsWrite2 } = await TestDataGenerator.generateRecordsWrite({ author });
        const message2Cid = await Message.getCid(message2);
        const message2Indexes = await recordsWrite2.constructIndexes(true);
        await eventLog.append(author.did, message2Cid, message2Indexes);

        for (let i = 0; i < 5; i += 1) {
          const { message, recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author, schema: 'schema1' });
          const messageCid = await Message.getCid(message);
          const indexes = await recordsWrite.constructIndexes(true);
          await eventLog.append(author.did, messageCid, indexes);

          expectedMessages.push(messageCid);
        }

        const { events } = await eventLog.queryEvents(author.did, [{ schema: normalizeSchemaUrl('schema1') }]);
        expect(events.length).to.equal(expectedMessages.length);

        for (let i = 0; i < expectedMessages.length; i += 1) {
          expect(events[i]).to.equal(expectedMessages[i]);
        }
      });

      it('returns filtered events after cursor', async () => {
        const author = await TestDataGenerator.generateDidKeyPersona();

        // message 1 schema1
        const { message, recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author, schema: 'schema1' });
        const messageCid = await Message.getCid(message);
        const indexes = await recordsWrite.constructIndexes(true);
        await eventLog.append(author.did, messageCid, indexes);

        // message 2 schema1
        const { message: message2, recordsWrite: recordsWrite2 } = await TestDataGenerator.generateRecordsWrite({ author, schema: 'schema1' });
        const message2Cid = await Message.getCid(message2);
        const message2Indexes = await recordsWrite2.constructIndexes(true);
        await eventLog.append(author.did, message2Cid, message2Indexes);

        // message 3 schema1
        const { message: message3, recordsWrite: recordsWrite3 } = await TestDataGenerator.generateRecordsWrite({ author, schema: 'schema1' });
        const message3Cid = await Message.getCid(message3);
        const message3Indexes = await recordsWrite3.constructIndexes(true);
        await eventLog.append(author.did, message3Cid, message3Indexes);

        // insert a record that will not show up in the filtered query.
        // not inserted into expected events because it's not a part of the schema.
        const { message: nonSchemaMessage1, recordsWrite: nonSchemaMessage1Write } = await TestDataGenerator.generateRecordsWrite({ author });
        const nonSchemaMessage1Cid = await Message.getCid(nonSchemaMessage1);
        const nonSchemaMessage1Indexes = await nonSchemaMessage1Write.constructIndexes(true);
        await eventLog.append(author.did, nonSchemaMessage1Cid, nonSchemaMessage1Indexes);

        // make initial query
        let { events, cursor } = await eventLog.queryEvents(author.did, [{ schema: normalizeSchemaUrl('schema1') }]);
        expect(events.length).to.equal(3);
        expect(events[0]).to.equal(await Message.getCid(message));
        expect(events[1]).to.equal(await Message.getCid(message2));
        expect(events[2]).to.equal(await Message.getCid(message3));

        // add an additional message to schema 1
        const { message: message4, recordsWrite: recordsWrite4 } = await TestDataGenerator.generateRecordsWrite({ author, schema: 'schema1' });
        const message4Cid = await Message.getCid(message4);
        const message4Indexes = await recordsWrite4.constructIndexes(true);
        await eventLog.append(author.did, message4Cid, message4Indexes);

        // insert another non schema record
        const { message: nonSchemaMessage2, recordsWrite: nonSchemaMessage2Write } = await TestDataGenerator.generateRecordsWrite({ author });
        const nonSchemaMessage2Cid = await Message.getCid(nonSchemaMessage2);
        const nonSchemaMessage2Indexes = await nonSchemaMessage2Write.constructIndexes(true);
        await eventLog.append(author.did, nonSchemaMessage2Cid, nonSchemaMessage2Indexes);

        ({ events } = await eventLog.queryEvents(author.did, [{ schema: normalizeSchemaUrl('schema1') }], cursor));
        expect(events.length).to.equal(1);
        expect(events[0]).to.equal(await Message.getCid(message4));
      });
    });
  });
}