import type { MessageStore } from '../../src/index.js';
import type { RecordsWriteMessage } from '../../src/types/records-types.js';

import { expect } from 'chai';

import { constructRecordsWriteIndexes } from '../../src/handlers/records-write.js';
import { lexicographicalCompare } from '../../src/utils/string.js';
import { Message } from '../../src/core/message.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStores } from '../test-stores.js';
import { DidKeyResolver, RecordsDateSort, TimestampDateSort } from '../../src/index.js';

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

        await messageStore.put(alice.did, message, {});

        const expectedCid = await Message.getCid(message);

        const jsonMessage = (await messageStore.get(alice.did, expectedCid))!;
        const resultCid = await Message.getCid(jsonMessage);

        expect(resultCid).to.equal(expectedCid);
      });

      // https://github.com/TBD54566975/dwn-sdk-js/issues/170
      it('#170 - should be able to update (delete and insert new) indexes to an existing message', async () => {
        const alice = await DidKeyResolver.generate();

        const { message } = await TestDataGenerator.generateRecordsWrite();

        // inserting the message indicating it is the 'latest' in the index
        await messageStore.put(alice.did, message, { latest: 'true' });

        const results1 = await messageStore.query(alice.did, { latest: 'true' });
        expect(results1.length).to.equal(1);

        const results2 = await messageStore.query(alice.did, { latest: 'false' });
        expect(results2.length).to.equal(0);

        // deleting the existing indexes and replacing it indicating it is no longer the 'latest'
        const cid = await Message.getCid(message);
        await messageStore.delete(alice.did, cid);
        await messageStore.put(alice.did, message, { latest: 'false' });

        const results3 = await messageStore.query(alice.did, { latest: 'true' });
        expect(results3.length).to.equal(0);

        const results4 = await messageStore.query(alice.did, { latest: 'false' });
        expect(results4.length).to.equal(1);
      });

      it('should index properties with characters beyond just letters and digits', async () => {
        const alice = await DidKeyResolver.generate();

        const schema = 'http://my-awesome-schema/awesomeness_schema';
        const { message } = await TestDataGenerator.generateRecordsWrite({ schema });

        await messageStore.put(alice.did, message, { schema });

        const results = await messageStore.query(alice.did, { schema });
        expect((results[0] as RecordsWriteMessage).descriptor.schema).to.equal(schema);
      });

      it('should not store anything if aborted beforehand', async () => {
        const alice = await DidKeyResolver.generate();

        const { message } = await TestDataGenerator.generateRecordsWrite();

        const controller = new AbortController();
        controller.signal.throwIfAborted = (): void => { }; // simulate aborting happening async
        controller.abort('reason');

        try {
          await messageStore.put(alice.did, message, {}, { signal: controller.signal });
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

        const controller = new AbortController();
        queueMicrotask(() => {
          controller.abort('reason');
        });

        try {
          await messageStore.put(alice.did, message, { schema }, { signal: controller.signal });
        } catch (e) {
          expect(e).to.equal('reason');
        }

        const results = await messageStore.query(alice.did, { schema });
        expect(results.length).to.equal(0);
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
        it('should sort on TimestampDescending if no sort is specified', async () => {
          const alice = await DidKeyResolver.generate();

          const messages = await Promise.all(Array(10).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            messageTimestamp: TestDataGenerator.randomTimestamp()
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await constructRecordsWriteIndexes(message.recordsWrite, true));
          }

          const messageQuery = await messageStore.query(alice.did, {});
          expect(messageQuery.length).to.equal(messages.length);

          const sortedRecords = messages.sort((a,b) =>
            lexicographicalCompare(b.message.descriptor.messageTimestamp, a.message.descriptor.messageTimestamp));
          for (let i = 0; i < sortedRecords.length; i++) {
            expect(sortedRecords[i].message.descriptor.messageTimestamp).to.equal(messageQuery[i].descriptor.messageTimestamp);
          }
        });

        it('should sort on TimestampAscending', async () => {
          const alice = await DidKeyResolver.generate();

          const messages = await Promise.all(Array(10).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            messageTimestamp: TestDataGenerator.randomTimestamp()
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await constructRecordsWriteIndexes(message.recordsWrite, true));
          }
          const messageQuery = await messageStore.query(alice.did, {}, TimestampDateSort.TimestampAscending);
          expect(messageQuery.length).to.equal(messages.length);

          const sortedRecords = messages.sort((a,b) =>
            lexicographicalCompare(a.message.descriptor.messageTimestamp, b.message.descriptor.messageTimestamp));
          for (let i = 0; i < messages.length; i++) {
            expect(sortedRecords[i].message.descriptor.messageTimestamp).to.equal(messageQuery[i].descriptor.messageTimestamp);
          }
        });

        it('should sort on CreatedAscending', async () => {
          const alice = await DidKeyResolver.generate();
          const messages = await Promise.all(Array(10).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            dateCreated: TestDataGenerator.randomTimestamp(),
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await constructRecordsWriteIndexes(message.recordsWrite, true));
          }

          const messageQuery = await messageStore.query(alice.did, {}, RecordsDateSort.CreatedAscending);
          expect(messageQuery.length).to.equal(messages.length);

          const sortedRecords = messages.sort((a,b) =>
            lexicographicalCompare(a.message.descriptor.dateCreated, b.message.descriptor.dateCreated));

          for (let i = 0; i < messages.length; i++) {
            expect(await Message.getCid(sortedRecords[i].message)).to.equal(await Message.getCid(messageQuery[i]));
          }
        });

        it('should sort on CreatedDescending', async () => {
          const alice = await DidKeyResolver.generate();
          const messages = await Promise.all(Array(10).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            dateCreated: TestDataGenerator.randomTimestamp(),
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await constructRecordsWriteIndexes(message.recordsWrite, true));
          }

          const messageQuery = await messageStore.query(alice.did, {}, RecordsDateSort.CreatedDescending);
          expect(messageQuery.length).to.equal(messages.length);

          const sortedRecords = messages.sort((a,b) =>
            lexicographicalCompare(b.message.descriptor.dateCreated, a.message.descriptor.dateCreated));

          for (let i = 0; i < messages.length; i++) {
            expect(await Message.getCid(sortedRecords[i].message)).to.equal(await Message.getCid(messageQuery[i]));
          }
        });

        it('should sort on PublishedAscending', async () => {
          const alice = await DidKeyResolver.generate();
          const messages = await Promise.all(Array(10).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            published     : true,
            datePublished : TestDataGenerator.randomTimestamp()
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await constructRecordsWriteIndexes(message.recordsWrite, true));
          }

          const messageQuery = await messageStore.query(alice.did, {}, RecordsDateSort.PublishedAscending);
          expect(messageQuery.length).to.equal(messages.length);

          const sortedRecords = messages.sort((a,b) =>
            lexicographicalCompare(a.message.descriptor.datePublished!, b.message.descriptor.datePublished!));

          for (let i = 0; i < messages.length; i++) {
            expect(await Message.getCid(sortedRecords[i].message)).to.equal(await Message.getCid(messageQuery[i]));
          }
        });

        it('should sort on PublishedDescending', async () => {
          const alice = await DidKeyResolver.generate();
          const messages = await Promise.all(Array(10).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            published     : true,
            datePublished : TestDataGenerator.randomTimestamp()
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await constructRecordsWriteIndexes(message.recordsWrite, true));
          }

          const messageQuery = await messageStore.query(alice.did, {}, RecordsDateSort.PublishedDescending);
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
            await messageStore.put(alice.did, message.message, await constructRecordsWriteIndexes(message.recordsWrite, true));
          }

          const limitQuery = await messageStore.query(alice.did, {}, TimestampDateSort.TimestampDescending);
          expect(limitQuery.length).to.equal(messages.length);
        });

        it('should limit records', async () => {
          const alice = await DidKeyResolver.generate();
          const messages = await Promise.all(Array(10).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            messageTimestamp: TestDataGenerator.randomTimestamp()
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await constructRecordsWriteIndexes(message.recordsWrite, true));
          }

          const sortedRecords = messages.sort((a,b) =>
            lexicographicalCompare(b.message.descriptor.messageTimestamp, a.message.descriptor.messageTimestamp));

          const offset = 0;
          const limit = 5;

          const limitQuery = await messageStore.query(alice.did, {}, TimestampDateSort.TimestampDescending, { offset, limit });
          expect(limitQuery.length).to.equal(limit);
          for (let i = 0; i < limitQuery.length; i++) {
            const offsetIndex = i + offset;
            expect(await Message.getCid(sortedRecords[offsetIndex].message)).to.equal(await Message.getCid(limitQuery[i]));
          }
        });

        it('should offset records without a limit', async () => {
          const alice = await DidKeyResolver.generate();
          const messages = await Promise.all(Array(13).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            messageTimestamp: TestDataGenerator.randomTimestamp()
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await constructRecordsWriteIndexes(message.recordsWrite, true));
          }

          const sortedRecords = messages.sort((a,b) =>
            lexicographicalCompare(b.message.descriptor.messageTimestamp, a.message.descriptor.messageTimestamp));

          const offset = 5;
          const limit = 0;

          const limitQuery = await messageStore.query(alice.did, {}, TimestampDateSort.TimestampDescending, { offset, limit });
          expect(limitQuery.length).to.equal(sortedRecords.length - offset);
          for (let i = 0; i < limitQuery.length; i++) {
            const offsetIndex = i + offset;
            expect(await Message.getCid(sortedRecords[offsetIndex].message)).to.equal(await Message.getCid(limitQuery[i]));
          }
        });

        it('should offset records with a limit', async () => {
          const alice = await DidKeyResolver.generate();
          const messages = await Promise.all(Array(10).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            messageTimestamp: TestDataGenerator.randomTimestamp()
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await constructRecordsWriteIndexes(message.recordsWrite, true));
          }

          const sortedRecords = messages.sort((a,b) =>
            lexicographicalCompare(b.message.descriptor.messageTimestamp, a.message.descriptor.messageTimestamp));

          const offset = 5;
          const limit = 3;

          const limitQuery = await messageStore.query(alice.did, {}, TimestampDateSort.TimestampDescending, { offset, limit });
          expect(limitQuery.length).to.equal(limit);
          for (let i = 0; i < limitQuery.length; i++) {
            const offsetIndex = i + offset;
            expect(await Message.getCid(sortedRecords[offsetIndex].message)).to.equal(await Message.getCid(limitQuery[i]));
          }
        });

        it('should paginate through all of the records', async () => {
          const alice = await DidKeyResolver.generate();
          const messages = await Promise.all(Array(23).fill({}).map((_) => TestDataGenerator.generateRecordsWrite({
            messageTimestamp: TestDataGenerator.randomTimestamp()
          })));
          for (const message of messages) {
            await messageStore.put(alice.did, message.message, await constructRecordsWriteIndexes(message.recordsWrite, true));
          }

          const totalRecords = messages.length;
          const limit = 6;
          const maxPage = Math.ceil(totalRecords / 5);
          const results = [];
          for (let i = 0; i < maxPage; i++) {
            const limitQuery = await messageStore.query(alice.did, {}, TimestampDateSort.TimestampDescending, { offset: i * limit, limit });
            expect(limitQuery.length).to.be.lessThanOrEqual(limit);
            results.push(...limitQuery);
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
