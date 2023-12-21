import type { MessageStore } from '../../src/index.js';
import type { PaginationCursor } from '../../src/types/query-types.js';
import type { RecordsWriteMessage } from '../../src/types/records-types.js';

import { expect } from 'chai';

import { DidKeyResolver } from '../../src/index.js';
import { lexicographicalCompare } from '../../src/utils/string.js';
import { Message } from '../../src/core/message.js';
import { SortDirection } from '../../src/types/query-types.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStores } from '../test-stores.js';

let messageStore: MessageStore;

export function testMessageStore(): void {
  describe('Generic MessageStore Test Suite', () => {
    describe('put', function () {

      // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
      // so that different test suites can reuse the same backend store for testing
      before(async () => {
        const stores = TestStores.get();
        messageStore = stores.messageStore;
        await messageStore.open();
      });

      beforeEach(async () => {
        await messageStore.clear(); // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
      });

      after(async () => {
        await messageStore.close();
      });

      it('stores messages as cbor/sha256 encoded blocks with CID as key', async () => {
        const alice = await DidKeyResolver.generate();

        const { message } = await TestDataGenerator.generatePermissionsRequest();
        const { messageTimestamp } = message.descriptor;

        await messageStore.put(alice.did, message, { messageTimestamp });

        const expectedCid = await Message.getCid(message);

        const jsonMessage = (await messageStore.get(alice.did, expectedCid))!;
        const resultCid = await Message.getCid(jsonMessage);

        expect(resultCid).to.equal(expectedCid);
      });

      // https://github.com/TBD54566975/dwn-sdk-js/issues/170
      it('#170 - should be able to update (delete and insert new) indexes to an existing message', async () => {
        const alice = await DidKeyResolver.generate();

        const { message } = await TestDataGenerator.generateRecordsWrite();
        const { messageTimestamp } = message.descriptor;

        // inserting the message indicating it is the 'latest' in the index
        await messageStore.put(alice.did, message, { latest: 'true', messageTimestamp });

        const { messages: results1 } = await messageStore.query(alice.did, [{ latest: 'true' }]);
        expect(results1.length).to.equal(1);

        const { messages: results2 } = await messageStore.query(alice.did, [{ latest: 'false' }]);
        expect(results2.length).to.equal(0);

        // deleting the existing indexes and replacing it indicating it is no longer the 'latest'
        const cid = await Message.getCid(message);
        await messageStore.delete(alice.did, cid);
        await messageStore.put(alice.did, message, { latest: 'false', messageTimestamp });

        const { messages: results3 } = await messageStore.query(alice.did, [{ latest: 'true' }]);
        expect(results3.length).to.equal(0);

        const { messages: results4 } = await messageStore.query(alice.did, [{ latest: 'false' }]);
        expect(results4.length).to.equal(1);
      });

      it('should index properties with characters beyond just letters and digits', async () => {
        const alice = await DidKeyResolver.generate();

        const schema = 'http://my-awesome-schema/awesomeness_schema';
        const { message } = await TestDataGenerator.generateRecordsWrite({ schema });
        const { messageTimestamp } = message.descriptor;

        await messageStore.put(alice.did, message, { schema, messageTimestamp });

        const { messages: results } = await messageStore.query(alice.did, [{ schema }]);
        expect((results[0] as RecordsWriteMessage).descriptor.schema).to.equal(schema);
      });

      it('should not store anything if aborted beforehand', async () => {
        const alice = await DidKeyResolver.generate();

        const { message } = await TestDataGenerator.generateRecordsWrite();
        const { messageTimestamp } = message.descriptor;

        const controller = new AbortController();
        controller.signal.throwIfAborted = (): void => { }; // simulate aborting happening async
        controller.abort('reason');

        try {
          await messageStore.put(alice.did, message, { messageTimestamp }, { signal: controller.signal });
        } catch (e) {
          expect(e).to.equal('reason');
        }

        const expectedCid = await Message.getCid(message);

        const jsonMessage = await messageStore.get(alice.did, expectedCid);
        expect(jsonMessage).to.equal(undefined);
      });

      it('should not index anything if aborted during', async () => {
        const alice = await DidKeyResolver.generate();

        const schema = 'http://my-awesome-schema/awesomeness_schema#awesome-1?id=awesome_1';
        const { message } = await TestDataGenerator.generateRecordsWrite({ schema });
        const { messageTimestamp } = message.descriptor;

        const controller = new AbortController();
        queueMicrotask(() => {
          controller.abort('reason');
        });

        try {
          await messageStore.put(alice.did, message, { schema, messageTimestamp }, { signal: controller.signal });
        } catch (e) {
          expect(e).to.equal('reason');
        }

        // index should not return the message
        const { messages: results } = await messageStore.query(alice.did, [{ schema }]);
        expect(results.length).to.equal(0);

        // check that message doesn't exist
        const messageCid = await Message.getCid(message);
        const fetchedMessage = await messageStore.get(alice.did, messageCid);
        expect(fetchedMessage).to.be.undefined;
      });

      it('should not store anything if aborted beforehand', async () => {
        const alice = await DidKeyResolver.generate();

        const { message } = await TestDataGenerator.generateRecordsWrite();
        const { messageTimestamp } = message.descriptor;

        const controller = new AbortController();
        controller.signal.throwIfAborted = (): void => { }; // simulate aborting happening async
        controller.abort('reason');

        try {
          await messageStore.put(alice.did, message, { messageTimestamp }, { signal: controller.signal });
        } catch (e) {
          expect(e).to.equal('reason');
        }

        const expectedCid = await Message.getCid(message);

        const jsonMessage = await messageStore.get(alice.did, expectedCid);
        expect(jsonMessage).to.equal(undefined);
      });

      it('should not delete if aborted', async () => {
        const alice = await DidKeyResolver.generate();

        const { message } = await TestDataGenerator.generateRecordsWrite();
        const { messageTimestamp } = message.descriptor;
        await messageStore.put(alice.did, message, { latest: 'true', messageTimestamp });

        const messageCid = await Message.getCid(message);
        const resultsAlice1 = await messageStore.get(alice.did, messageCid);
        expect((resultsAlice1 as RecordsWriteMessage).recordId).to.equal((message as RecordsWriteMessage).recordId);

        const controller = new AbortController();
        controller.signal.throwIfAborted = (): void => { }; // simulate aborting happening async
        controller.abort('reason');

        // aborted delete
        const deletePromise = messageStore.delete(alice.did, messageCid, { signal: controller.signal });
        await expect(deletePromise).to.eventually.rejectedWith('reason');
      });

      it('should not delete the message of another tenant', async () => {
        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();

        const { message } = await TestDataGenerator.generateRecordsWrite();
        const { messageTimestamp } = message.descriptor;
        await messageStore.put(alice.did, message, { latest: 'true', messageTimestamp });
        await messageStore.put(bob.did, message, { latest: 'true', messageTimestamp });

        const messageCid = await Message.getCid(message);
        const resultsAlice1 = await messageStore.get(alice.did, messageCid);
        expect((resultsAlice1 as RecordsWriteMessage).recordId).to.equal((message as RecordsWriteMessage).recordId);
        const resultsBob1 = await messageStore.get(bob.did, messageCid);
        expect((resultsBob1 as RecordsWriteMessage).recordId).to.equal((message as RecordsWriteMessage).recordId);

        // bob deletes message
        await messageStore.delete(bob.did, messageCid);
        const resultsBob2 = await messageStore.get(bob.did, messageCid);
        expect(resultsBob2).to.be.undefined;

        //expect alice to retain the message
        const resultsAlice2 = await messageStore.get(alice.did, messageCid);
        expect((resultsAlice2 as RecordsWriteMessage).recordId).to.equal((message as RecordsWriteMessage).recordId);
      });

      it('should not clear the MessageStore index of another tenant', async () => {
        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();

        const { message } = await TestDataGenerator.generateRecordsWrite();
        const { messageTimestamp } = message.descriptor;

        await messageStore.put(alice.did, message, { latest: 'true', messageTimestamp });
        await messageStore.put(bob.did, message, { latest: 'true', messageTimestamp });

        const messageCid = await Message.getCid(message);
        const resultsAlice1 = await messageStore.query(alice.did, [{ latest: 'true' }]);
        expect(resultsAlice1.messages.length).to.equal(1);
        const resultsBob1 = await messageStore.query(bob.did, [{ latest: 'true' }]);
        expect(resultsBob1.messages.length).to.equal(1);

        // bob deletes message
        await messageStore.delete(bob.did, messageCid);
        const resultsBob2 = await messageStore.query(bob.did, [{ latest: 'true' }]);
        expect(resultsBob2.messages.length).to.equal(0);

        //expect alice to retain the message
        const resultsAlice2 = await messageStore.query(alice.did, [{ latest: 'true' }]);
        expect(resultsAlice2.messages.length).to.equal(1);
      });
    });

    describe('sort and pagination', () => {

      // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
      // so that different test suites can reuse the same backend store for testing
      before(async () => {
        const stores = TestStores.get();
        messageStore = stores.messageStore;
        await messageStore.open();
      });

      beforeEach(async () => {
        await messageStore.clear(); // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
      });

      after(async () => {
        await messageStore.close();
      });

      describe('sorting', async () => {
        it('should sort on messageTimestamp Ascending if no sort is specified', async () => {
          const alice = await DidKeyResolver.generate();

          const messages = await Promise.all(Array(10).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            messageTimestamp: TestDataGenerator.randomTimestamp()
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await message.recordsWrite.constructIndexes(true));
          }

          const { messages: messageQuery } = await messageStore.query(alice.did, [{}]);
          expect(messageQuery.length).to.equal(messages.length);

          const sortedRecords = messages.sort((a,b) =>
            lexicographicalCompare(a.message.descriptor.messageTimestamp, b.message.descriptor.messageTimestamp));
          for (let i = 0; i < sortedRecords.length; i++) {
            expect(sortedRecords[i].message.descriptor.messageTimestamp).to.equal(messageQuery[i].descriptor.messageTimestamp);
          }
        });

        it('should sort on messageTimestamp Ascending', async () => {
          const alice = await DidKeyResolver.generate();

          const messages = await Promise.all(Array(10).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            messageTimestamp: TestDataGenerator.randomTimestamp()
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await message.recordsWrite.constructIndexes(true));
          }
          const { messages: messageQuery } = await messageStore.query(alice.did, [{}], { messageTimestamp: SortDirection.Ascending });
          expect(messageQuery.length).to.equal(messages.length);

          const sortedRecords = messages.sort((a,b) =>
            lexicographicalCompare(a.message.descriptor.messageTimestamp, b.message.descriptor.messageTimestamp));
          for (let i = 0; i < messages.length; i++) {
            expect(sortedRecords[i].message.descriptor.messageTimestamp).to.equal(messageQuery[i].descriptor.messageTimestamp);
          }
        });

        it('should sort on dateCreated Ascending', async () => {
          const alice = await DidKeyResolver.generate();
          const messages = await Promise.all(Array(10).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            dateCreated: TestDataGenerator.randomTimestamp(),
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await message.recordsWrite.constructIndexes(true));
          }

          const { messages: messageQuery } = await messageStore.query(alice.did, [{}], { dateCreated: SortDirection.Ascending });
          expect(messageQuery.length).to.equal(messages.length);

          const sortedRecords = messages.sort((a,b) =>
            lexicographicalCompare(a.message.descriptor.dateCreated, b.message.descriptor.dateCreated));

          for (let i = 0; i < messages.length; i++) {
            expect(await Message.getCid(sortedRecords[i].message)).to.equal(await Message.getCid(messageQuery[i]));
          }
        });

        it('should sort on dateCreated Descending', async () => {
          const alice = await DidKeyResolver.generate();
          const messages = await Promise.all(Array(10).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            dateCreated: TestDataGenerator.randomTimestamp(),
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await message.recordsWrite.constructIndexes(true));
          }

          const { messages: messageQuery } = await messageStore.query(alice.did, [{}], { dateCreated: SortDirection.Descending });
          expect(messageQuery.length).to.equal(messages.length);

          const sortedRecords = messages.sort((a,b) =>
            lexicographicalCompare(b.message.descriptor.dateCreated, a.message.descriptor.dateCreated));

          for (let i = 0; i < messages.length; i++) {
            expect(await Message.getCid(sortedRecords[i].message)).to.equal(await Message.getCid(messageQuery[i]));
          }
        });

        it('should sort on datePublished Ascending', async () => {
          const alice = await DidKeyResolver.generate();
          const messages = await Promise.all(Array(10).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            published     : true,
            datePublished : TestDataGenerator.randomTimestamp()
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await message.recordsWrite.constructIndexes(true));
          }

          const { messages: messageQuery } = await messageStore.query(alice.did, [{}], { datePublished: SortDirection.Ascending });
          expect(messageQuery.length).to.equal(messages.length);

          const sortedRecords = messages.sort((a,b) =>
            lexicographicalCompare(a.message.descriptor.datePublished!, b.message.descriptor.datePublished!));

          for (let i = 0; i < messages.length; i++) {
            expect(await Message.getCid(sortedRecords[i].message)).to.equal(await Message.getCid(messageQuery[i]));
          }
        });

        it('should sort on datePublished Descending', async () => {
          const alice = await DidKeyResolver.generate();
          const messages = await Promise.all(Array(10).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            published     : true,
            datePublished : TestDataGenerator.randomTimestamp()
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await message.recordsWrite.constructIndexes(true));
          }

          const { messages: messageQuery } = await messageStore.query(alice.did, [{}], { datePublished: SortDirection.Descending });
          expect(messageQuery.length).to.equal(messages.length);

          const sortedRecords = messages.sort((a,b) =>
            lexicographicalCompare(b.message.descriptor.datePublished!, a.message.descriptor.datePublished!));

          for (let i = 0; i < messages.length; i++) {
            expect(await Message.getCid(sortedRecords[i].message)).to.equal(await Message.getCid(messageQuery[i]));
          }
        });
      });

      describe('pagination', async () => {
        it('should return all records if no limit is specified', async () => {
          const alice = await DidKeyResolver.generate();
          const messages = await Promise.all(Array(10).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            messageTimestamp: TestDataGenerator.randomTimestamp()
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await message.recordsWrite.constructIndexes(true));
          }

          const { messages: limitQuery } = await messageStore.query(alice.did, [{}]);
          expect(limitQuery.length).to.equal(messages.length);
        });

        it('should limit records', async () => {
          const alice = await DidKeyResolver.generate();
          const messages = await Promise.all(Array(10).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            messageTimestamp: TestDataGenerator.randomTimestamp()
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await message.recordsWrite.constructIndexes(true));
          }

          const sortedRecords = messages.sort((a,b) =>
            lexicographicalCompare(a.message.descriptor.messageTimestamp, b.message.descriptor.messageTimestamp));

          const limit = 5;

          const { messages: limitQuery } = await messageStore.query(alice.did, [{}], {}, { limit });
          expect(limitQuery.length).to.equal(limit);
          for (let i = 0; i < limitQuery.length; i++) {
            expect(await Message.getCid(sortedRecords[i].message)).to.equal(await Message.getCid(limitQuery[i]));
          }
        });

        it('should only return a cursor if there are additional results', async () => {
          const alice = await DidKeyResolver.generate();
          const messages = await Promise.all(Array(10).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            messageTimestamp: TestDataGenerator.randomTimestamp()
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await message.recordsWrite.constructIndexes(true));
          }

          // get all of the records
          const allRecords = await messageStore.query(alice.did, [{}], {}, { limit: 10 });
          expect(allRecords.cursor).to.not.exist;

          // get only partial records
          const partialRecords = await messageStore.query(alice.did, [{}], {}, { limit: 5 });
          expect(partialRecords.cursor).to.exist.and.to.not.be.undefined;
        });

        it('should return all records from the cursor onwards when no limit is provided', async () => {
          const alice = await DidKeyResolver.generate();
          const messages = await Promise.all(Array(13).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            messageTimestamp: TestDataGenerator.randomTimestamp()
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await message.recordsWrite.constructIndexes(true));
          }

          const sortedRecords = messages.sort((a,b) =>
            lexicographicalCompare(a.message.descriptor.messageTimestamp, b.message.descriptor.messageTimestamp));

          // we make an initial request to get one record and a cursor.
          const { cursor } = await messageStore.query(alice.did, [{}], {}, { limit: 1 });

          const { messages: limitQuery } = await messageStore.query(alice.did, [{}], {}, { cursor });
          expect(limitQuery.length).to.equal(sortedRecords.slice(1).length);
          for (let i = 0; i < limitQuery.length; i++) {
            const offsetIndex = i + 1; // offset for the initial request item
            expect(await Message.getCid(sortedRecords[offsetIndex].message)).to.equal(await Message.getCid(limitQuery[i]));
          }
        });

        it('should limit records when a cursor and limit are provided', async () => {
          const alice = await DidKeyResolver.generate();
          const messages = await Promise.all(Array(10).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            messageTimestamp: TestDataGenerator.randomTimestamp()
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await message.recordsWrite.constructIndexes(true));
          }

          const sortedRecords = messages.sort((a,b) =>
            lexicographicalCompare(a.message.descriptor.messageTimestamp, b.message.descriptor.messageTimestamp));

          // we make an initial request to get one record and a cursor.
          const { cursor } = await messageStore.query(alice.did, [{}], {}, { limit: 1 });

          const limit = 3;
          const { messages: limitQuery } = await messageStore.query(alice.did, [{}], {}, { cursor, limit });
          expect(limitQuery.length).to.equal(limit);
          for (let i = 0; i < limitQuery.length; i++) {
            const offsetIndex = i + 1; // offset for the initial request item
            expect(await Message.getCid(sortedRecords[offsetIndex].message)).to.equal(await Message.getCid(limitQuery[i]));
          }
        });

        it('should paginate through all of the records', async () => {
          const alice = await DidKeyResolver.generate();
          const messages = await Promise.all(Array(23).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            messageTimestamp: TestDataGenerator.randomTimestamp()
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await message.recordsWrite.constructIndexes(true));
          }

          const limit = 6;
          const results = [];
          let cursor: PaginationCursor | undefined;
          while (true) {
            const { messages: limitQuery, cursor: queryCursor } = await messageStore.query(alice.did, [{}], {}, { cursor, limit });
            expect(limitQuery.length).to.be.lessThanOrEqual(limit);
            results.push(...limitQuery);
            cursor = queryCursor;
            if (cursor === undefined) {
              break;
            }
          }
          expect(results.length).to.equal(messages.length);
          const messageMessageIds = await Promise.all(messages.map(m => Message.getCid(m.message)));
          const resultMessageIds = await Promise.all(results.map(m => Message.getCid(m)));
          for (const recordId of messageMessageIds) {
            expect(resultMessageIds.includes(recordId)).to.be.true;
          }
        });
      });
    });
  });
}
