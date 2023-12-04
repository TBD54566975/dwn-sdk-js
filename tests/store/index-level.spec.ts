import type { Filter } from '../../src/types/query-types.js';

import { ArrayUtility } from '../../src/utils/array.js';
import { createLevelDatabase } from '../../src/store/level-wrapper.js';
import { IndexLevel } from '../../src/store/index-level.js';
import { lexicographicalCompare } from '../../src/utils/string.js';
import { SortDirection } from '../../src/types/query-types.js';
import { Temporal } from '@js-temporal/polyfill';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { v4 as uuid } from 'uuid';
import { DwnErrorCode, Encoder } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

chai.use(chaiAsPromised);


describe('IndexLevel', () => {
  let testIndex: IndexLevel;
  const tenant = 'did:alice:index-test';

  describe('put', () => {
    before(async () => {
      testIndex = new IndexLevel({
        createLevelDatabase,
        location: 'TEST-INDEX',
      });
      await testIndex.open();
    });

    beforeEach(async () => {
      await testIndex.clear();
    });

    after(async () => {
      await testIndex.close();
    });

    describe('fails to index with no indexable properties', () => {
      it('fails on empty indexes', async () => {
        const id = uuid();
        const failedIndexPromise = testIndex.put(tenant, id, {});
        await expect(failedIndexPromise).to.eventually.be.rejectedWith(DwnErrorCode.IndexMissingIndexableProperty);
      });
    });

    it('successfully indexes', async () => {
      const id = uuid();
      const successfulIndex = testIndex.put(tenant, id, {
        id,
        foo: 'foo',
      });
      await expect(successfulIndex).to.eventually.not.be.rejected;
      const results = await testIndex.query(tenant, [{ id: id }], { sortProperty: 'id' });
      expect(results.entries[0]).to.equal(id);
    });

    it('adds one index key per property, aside from id', async () => {
      const id = uuid();
      const dateCreated = new Date().toISOString();

      await testIndex.put(tenant, id, {
        'a' : 'b', // 1 key
        'c' : 'd', // 1 key
        dateCreated, // 1 key
      });

      let keys = await ArrayUtility.fromAsyncGenerator(testIndex.db.keys());
      expect(keys.length).to.equal(4);

      await testIndex.clear();

      await testIndex.put(tenant, id, {
        'a' : 'b', // 1 key
        'c' : 'd', // 1 ke
        'e' : 'f', // 1 key
        dateCreated, // 1 key
      });
      keys = await ArrayUtility.fromAsyncGenerator(testIndex.db.keys());
      expect(keys.length).to.equal(5);
    });

    it('should not put anything if aborted beforehand', async () => {
      const controller = new AbortController();
      controller.abort('reason');

      const id = uuid();
      const index = {
        id,
        foo: 'bar'
      };

      const indexPromise = testIndex.put(tenant, id, index, { signal: controller.signal });
      await expect(indexPromise).to.eventually.rejectedWith('reason');

      const { entries } = await testIndex.query(tenant, [{ foo: 'bar' }], { sortProperty: 'id' });
      expect(entries.length).to.equal(0);
    });
  });

  describe('query', () => {
    before(async () => {
      testIndex = new IndexLevel({
        createLevelDatabase,
        location: 'TEST-INDEX',
      });
      await testIndex.open();
    });

    beforeEach(async () => {
      await testIndex.clear();
    });

    after(async () => {
      await testIndex.close();
    });

    it('works', async () =>{
      const id1 = uuid();
      const doc1 = {
        id  : id1,
        'a' : 'b',
        'c' : 'd'
      };

      const id2 = uuid();
      const doc2 = {
        id  : id2,
        'a' : 'c',
        'c' : 'd'
      };

      const id3 = uuid();
      const doc3 = {
        id  : id3,
        'a' : 'b',
        'c' : 'e'
      };

      await testIndex.put(tenant, id1, doc1);
      await testIndex.put(tenant, id2, doc2);
      await testIndex.put(tenant, id3, doc3);

      const { entries } = await testIndex.query(tenant, [{
        'a' : 'b',
        'c' : 'e'
      }], { sortProperty: 'id' });

      expect(entries.length).to.equal(1);
      expect(entries[0]).to.equal(id3);
    });

    it('should return all records if an empty filter array is passed', async () => {
      const items = [ 'b', 'a', 'd', 'c' ];
      for (const item of items) {
        await testIndex.put(tenant, item, { letter: item, index: items.indexOf(item) });
      }

      // empty array
      let allResults = await testIndex.query(tenant, [],{ sortProperty: 'letter' });
      expect(allResults.entries).to.eql(['a', 'b', 'c', 'd']);

      // empty filter
      allResults = await testIndex.query(tenant, [{}],{ sortProperty: 'letter' });
      expect(allResults.entries).to.eql(['a', 'b', 'c', 'd']);
    });

    describe('queryWithIteratorPaging()', () => {
      it('only return a cursor if there are additional results when `strictCursor` is set to true', async () => {
        const testVals = ['b', 'd', 'c', 'a'];
        for (const val of testVals) {
          await testIndex.put(tenant, val, { val, schema: 'schema', published: true });
        }

        // insert other records to be filtered out
        for (const val of testVals) {
          const otherVal = val + val;
          await testIndex.put(tenant, otherVal, { val: otherVal, schema: 'schema', published: false });
        }

        const filters = [{ schema: 'schema', published: true }];

        // control test: return a cursor even though all results have been returned
        let notStrictCursor = await testIndex.queryWithIteratorPaging(tenant, filters, { sortProperty: 'val' });
        expect(notStrictCursor.entries.length).to.equal(4);
        expect(notStrictCursor.cursor).to.not.be.undefined; // cursor is defined

        // control test: return a cursor even though all results have been returned with strict set to false explicitly
        notStrictCursor = await testIndex.queryWithIteratorPaging(tenant, filters, { sortProperty: 'val', strictCursor: false });
        expect(notStrictCursor.entries.length).to.equal(4);
        expect(notStrictCursor.cursor).to.not.be.undefined; // cursor is defined

        let strictCursor = await testIndex.queryWithIteratorPaging(tenant, filters, { sortProperty: 'val', strictCursor: true });
        expect(strictCursor.entries.length).to.equal(4);
        expect(strictCursor.cursor).to.be.undefined; // cursor undefined

        strictCursor = await testIndex.queryWithIteratorPaging(tenant, filters, { sortProperty: 'val', strictCursor: true, limit: 3 });
        expect(strictCursor.entries.length).to.equal(3);
        expect(strictCursor.cursor).to.not.be.undefined; // cursor is defined because there is another result
      });

      it('paginates using cursor', async () => {
        const testVals = ['b', 'd', 'c', 'a'];
        for (const val of testVals) {
          await testIndex.put(tenant, val, { val, schema: 'schema', published: true });
        }

        // insert other records to be filtered out
        for (const val of testVals) {
          const otherVal = val + val;
          await testIndex.put(tenant, otherVal, { val: otherVal, schema: 'schema', published: false });
        }

        const filters = [{ schema: 'schema', published: true }];

        // query with limit, default (ascending)
        const results = await testIndex.queryWithIteratorPaging(tenant, filters, { sortProperty: 'val', limit: 2 });
        expect(results.entries.length).to.equal(2);
        expect(results.entries).to.eql(['a', 'b']);
        expect(results.cursor).to.not.be.undefined;

        // query with cursor, default (ascending)
        const resultsAfterCursor = await testIndex.queryWithIteratorPaging(tenant, filters, { sortProperty: 'val', cursor: results.cursor });
        expect(resultsAfterCursor.entries.length).to.equal(2);
        expect(resultsAfterCursor.entries).to.eql(['c', 'd']);

        // query with limit, explicit ascending
        const ascResults = await testIndex.queryWithIteratorPaging(tenant, filters, { sortProperty: 'val', limit: 2 });
        expect(ascResults.entries.length).to.equal(2);
        expect(ascResults.entries).to.eql(['a', 'b']);
        expect(ascResults.cursor).to.not.be.undefined;

        // query with cursor, explicit ascending
        const ascResultsAfterCursor = await testIndex.queryWithIteratorPaging(tenant, filters, { sortProperty: 'val', cursor: ascResults.cursor });
        expect(ascResultsAfterCursor.entries.length).to.equal(2);
        expect(ascResultsAfterCursor.entries).to.eql(['c', 'd']);

        // query with limit, descending
        const descResults = await testIndex.queryWithIteratorPaging(tenant, filters, { sortDirection: SortDirection.Descending, sortProperty: 'val', limit: 2 });
        expect(descResults.entries.length).to.equal(2);
        expect(descResults.entries).to.eql(['d', 'c']);
        expect(descResults.cursor).to.not.be.undefined;

        // query with cursor, descending
        const descResultsAfterCursor = await testIndex.queryWithIteratorPaging(tenant, filters, { sortDirection: SortDirection.Descending, sortProperty: 'val', cursor: descResults.cursor });
        expect(descResultsAfterCursor.entries.length).to.equal(2);
        expect(descResultsAfterCursor.entries).to.eql(['b', 'a']);
      });

      it('returns empty array if sort property is invalid', async () => {
        const testVals = ['b', 'd', 'c', 'a'];
        for (const val of testVals) {
          await testIndex.put(tenant, val, { val, schema: 'schema', published: true });
        }

        // insert other records to be filtered out
        for (const val of testVals) {
          const otherVal = val + val;
          await testIndex.put(tenant, otherVal, { val: otherVal, schema: 'schema', published: false });
        }

        const filters = [{ schema: 'schema', published: true }];

        // control test: return all results
        const validResults = await testIndex.queryWithIteratorPaging(tenant, filters, { sortProperty: 'val' });
        expect(validResults.entries.length).to.equal(4);

        // sort by invalid property returns no results
        const invalidResults = await testIndex.queryWithIteratorPaging(tenant, filters, { sortProperty: 'invalid' });
        expect(invalidResults.entries.length).to.equal(0);

        const invalidResultsStrict = await testIndex.queryWithIteratorPaging(tenant, filters, { sortProperty: 'invalid', strictCursor: true });
        expect(invalidResultsStrict.entries.length).to.equal(0);
      });

      it('cursor is valid but out of range of matched results', async () => {
        const testVals = ['b', 'd', 'c']; // a is missing
        for (const val of testVals) {
          await testIndex.put(tenant, `${val}-id`, { val, schema: 'schema', published: true });
        }
        // insert other records to be filtered out
        for (const val of testVals) {
          const otherVal = val + val;
          await testIndex.put(tenant, `${val}-id`, { val: otherVal, schema: 'schema', published: false });
        }

        const filters = [{ schema: 'schema', published: true }];
        const cursorA = IndexLevel.encodeCursor('a-id', 'a'); // before results

        const allResults = await testIndex.queryWithIteratorPaging(tenant, filters, { sortProperty: 'val', cursor: cursorA });
        expect(allResults.entries).to.eql(['b-id', 'c-id', 'd-id']);

        const cursorE = IndexLevel.encodeCursor('e-id', 'e'); // after results
        const noResults = await testIndex.queryWithIteratorPaging(tenant, filters, { sortProperty: 'val', cursor: cursorE });
        expect(noResults.entries.length).to.eql(0);
        expect(noResults.cursor).to.equal(cursorE); // retains original cursor

        // check strict cursor
        const noResultsStrict = await testIndex.queryWithIteratorPaging(tenant, filters, { sortProperty: 'val', cursor: cursorE, strictCursor: true });
        expect(noResultsStrict.entries.length).to.eql(0);
        expect(noResultsStrict.cursor).to.be.undefined;
      });

      it('throws with an invalid cursor', async () => {
        const filters = [{ schema: 'schema', published: true }];
        const someBase64String = Encoder.stringToBase64Url(TestDataGenerator.randomString(10));
        const invalidResultsPromise = testIndex.queryWithIteratorPaging(tenant, filters, { sortProperty: 'val', cursor: someBase64String });
        await expect(invalidResultsPromise).to.eventually.be.rejectedWith(DwnErrorCode.IndexInvalidCursorFormat);
      });
    });

    describe('queryWithInMemoryPaging()', () => {
      it('only return a cursor if there are additional results when `strictCursor` is set to true', async () => {
        const testVals = ['b', 'd', 'c', 'a'];
        for (const val of testVals) {
          await testIndex.put(tenant, val, { val, schema: 'schema', published: true });
        }

        // insert other records to be filtered out
        for (const val of testVals) {
          const otherVal = val + val;
          await testIndex.put(tenant, otherVal, { val: otherVal, schema: 'schema', published: false });
        }

        const filters = [{ schema: 'schema', published: true }];

        // control test: return a cursor even though all results have been returned
        let notStrictCursor = await testIndex.queryWithInMemoryPaging(tenant, filters, { sortProperty: 'val' });
        expect(notStrictCursor.entries.length).to.equal(4);
        expect(notStrictCursor.cursor).to.not.be.undefined; // cursor is defined

        // control test: return a cursor even though all results have been returned with strict set to false explicitly
        notStrictCursor = await testIndex.queryWithInMemoryPaging(tenant, filters, { sortProperty: 'val', strictCursor: false });
        expect(notStrictCursor.entries.length).to.equal(4);
        expect(notStrictCursor.cursor).to.not.be.undefined; // cursor is defined

        let strictCursor = await testIndex.queryWithInMemoryPaging(tenant, filters, { sortProperty: 'val', strictCursor: true });
        expect(strictCursor.entries.length).to.equal(4);
        expect(strictCursor.cursor).to.be.undefined; // cursor undefined

        strictCursor = await testIndex.queryWithInMemoryPaging(tenant, filters, { sortProperty: 'val', strictCursor: true, limit: 3 });
        expect(strictCursor.entries.length).to.equal(3);
        expect(strictCursor.cursor).to.not.be.undefined; // cursor is defined because there is another result
      });

      it('paginates using cursor', async () => {
        const testVals = ['b', 'd', 'c', 'a'];
        for (const val of testVals) {
          await testIndex.put(tenant, val, { val, schema: 'schema', published: true });
        }

        // insert other records to be filtered out
        for (const val of testVals) {
          const otherVal = val + val;
          await testIndex.put(tenant, otherVal, { val: otherVal, schema: 'schema', published: false });
        }

        const filters = [{ schema: 'schema', published: true }];

        // query with limit, default (ascending)
        const results = await testIndex.queryWithInMemoryPaging(tenant, filters, { sortProperty: 'val', limit: 2 });
        expect(results.entries.length).to.equal(2);
        expect(results.entries).to.eql(['a', 'b']);
        expect(results.cursor).to.not.be.undefined;

        // query with cursor, default (ascending)
        const resultsAfterCursor = await testIndex.queryWithInMemoryPaging(tenant, filters, { sortProperty: 'val', cursor: results.cursor });
        expect(resultsAfterCursor.entries.length).to.equal(2);
        expect(resultsAfterCursor.entries).to.eql(['c', 'd']);

        // query with limit, explicit ascending
        const ascResults = await testIndex.queryWithInMemoryPaging(tenant, filters, { sortProperty: 'val', limit: 2 });
        expect(ascResults.entries.length).to.equal(2);
        expect(ascResults.entries).to.eql(['a', 'b']);
        expect(ascResults.cursor).to.not.be.undefined;

        // query with cursor, explicit ascending
        const ascResultsAfterCursor = await testIndex.queryWithInMemoryPaging(tenant, filters, { sortProperty: 'val', cursor: ascResults.cursor });
        expect(ascResultsAfterCursor.entries.length).to.equal(2);
        expect(ascResultsAfterCursor.entries).to.eql(['c', 'd']);

        // query with limit, descending
        const descResults = await testIndex.queryWithInMemoryPaging(tenant, filters, { sortDirection: SortDirection.Descending, sortProperty: 'val', limit: 2 });
        expect(descResults.entries.length).to.equal(2);
        expect(descResults.entries).to.eql(['d', 'c']);
        expect(descResults.cursor).to.not.be.undefined;

        // query with cursor, descending
        const descResultsAfterCursor = await testIndex.queryWithInMemoryPaging(tenant, filters, { sortDirection: SortDirection.Descending , sortProperty: 'val', cursor: descResults.cursor });
        expect(descResultsAfterCursor.entries.length).to.equal(2);
        expect(descResultsAfterCursor.entries).to.eql(['b', 'a']);
      });

      it('returns empty array if sort property is invalid', async () => {
        const testVals = ['b', 'd', 'c', 'a'];
        for (const val of testVals) {
          await testIndex.put(tenant, val, { val, schema: 'schema', published: true });
        }

        // insert other records to be filtered out
        for (const val of testVals) {
          const otherVal = val + val;
          await testIndex.put(tenant, otherVal, { val: otherVal, schema: 'schema', published: false });
        }

        const filters = [{ schema: 'schema', published: true }];

        // control test: return all results
        const validResults = await testIndex.queryWithInMemoryPaging(tenant, filters, { sortProperty: 'val', limit: 3 });
        expect(validResults.entries.length).to.equal(3);

        // sort by invalid property returns no results
        const invalidResults = await testIndex.queryWithInMemoryPaging(tenant, filters, { sortProperty: 'invalid' });
        expect(invalidResults.entries.length).to.equal(0);

        const invalidResultsStrict = await testIndex.queryWithInMemoryPaging(tenant, filters, { sortProperty: 'invalid', strictCursor: true });
        expect(invalidResultsStrict.entries.length).to.equal(0);
      });

      it('cursor is valid but out of range of matched results', async () => {
        const testVals = ['b', 'd', 'c', 'a'];
        for (const val of testVals) {
          await testIndex.put(tenant, val, { val, schema: 'schema', published: true });
        }

        // insert other records to be filtered out
        for (const val of testVals) {
          const otherVal = val + val;
          await testIndex.put(tenant, otherVal, { val: otherVal, schema: 'schema', published: false });
        }

        const filters = [{ schema: 'schema', published: true }];
        const cursorA = IndexLevel.encodeCursor('a', 'a'); // before results

        const allResults = await testIndex.queryWithInMemoryPaging(tenant, filters, { sortProperty: 'val', cursor: cursorA });
        expect(allResults.entries).to.eql(['b', 'c', 'd']);

        const cursorE = IndexLevel.encodeCursor('e', 'e'); // after results
        const noResults = await testIndex.queryWithInMemoryPaging(tenant, filters, { sortProperty: 'val', cursor: cursorE });
        expect(noResults.entries.length).to.eql(0);
        expect(noResults.cursor).to.equal(cursorE); // retains original cursor

        // check strict cursor
        const noResultsStrict = await testIndex.queryWithInMemoryPaging(tenant, filters, { sortProperty: 'val', cursor: cursorE, strictCursor: true });
        expect(noResultsStrict.entries.length).to.eql(0);
        expect(noResultsStrict.cursor).to.be.undefined;
      });

      it('throws with an invalid cursor', async () => {
        const filters = [{ schema: 'schema' }];
        const someBase64String = Encoder.stringToBase64Url(TestDataGenerator.randomString(10));
        const invalidResultsPromise = testIndex.queryWithInMemoryPaging(tenant, filters, { sortProperty: 'val', cursor: someBase64String });
        await expect(invalidResultsPromise).to.eventually.be.rejectedWith(DwnErrorCode.IndexInvalidCursorFormat);
      });

      it('supports range queries', async () => {
        const id = uuid();
        const doc1 = {
          id,
          value: 'foo'
        };
        await testIndex.put(tenant, id, doc1);

        const id2 = uuid();
        const doc2 = {
          id    : id2,
          value : 'foobar'
        };
        await testIndex.put(tenant, id2, doc2);

        const id3 = uuid();
        const doc3 = {
          id    : id3,
          value : 'foobaz'
        };
        await testIndex.put(tenant, id3, doc3);

        const filters = [{
          value: {
            gt  : 'foo',
            lte : 'foobaz'
          }
        }];

        const { entries } = await testIndex.queryWithInMemoryPaging(tenant, filters, { sortProperty: 'id' });

        expect(entries.length).to.equal(2);
        expect(entries).to.have.members([id2, id3]);

        // only upper bounds
        const lteFilter = [{
          value: {
            lte: 'foobaz'
          }
        }];
        const lteReply = await testIndex.queryWithInMemoryPaging(tenant, lteFilter, { sortProperty: 'id' });

        expect(lteReply.entries.length).to.equal(3);
        expect(lteReply.entries).to.have.members([id, id2, id3]);

      });
    });

    describe('query()', () => {
      it('should not match values prefixed with the query', async () => {
        const id = uuid();
        const doc = {
          id,
          value: 'foobar'
        };

        await testIndex.put(tenant, id, doc);

        const filters = [{ value: 'foo' }];
        const { entries } = await testIndex.query(tenant, filters, { sortProperty: 'id' });
        expect(entries.length).to.equal(0);

      });

      it('supports OR queries', async () => {
        const id1 = uuid();
        const doc1 = {
          id  : id1,
          'a' : 'a'
        };

        const id2 = uuid();
        const doc2 = {
          id  : id2,
          'a' : 'b'
        };

        const id3 = uuid();
        const doc3 = {
          id  : id3,
          'a' : 'c'
        };

        await testIndex.put(tenant, id1, doc1);
        await testIndex.put(tenant, id2, doc2);
        await testIndex.put(tenant, id3, doc3);

        const filters = [{
          a: [ 'a', 'b' ]
        }];

        const { entries } = await testIndex.query(tenant, filters , { sortProperty: 'id' });

        expect(entries.length).to.equal(2);
        expect(entries).to.include(id1);
        expect(entries).to.include(id2);
      });

      it('supports range queries', async () => {
        for (let i = -5; i < 5; ++i) {
          const id = uuid();
          const doc = {
            id,
            dateCreated: Temporal.PlainDateTime.from({ year: 2023, month: 1, day: 15 + i }).toString({ smallestUnit: 'microseconds' })
          };

          await testIndex.put(tenant, id, doc);
        }

        const filters = [{
          dateCreated: {
            gte: Temporal.PlainDateTime.from({ year: 2023, month: 1, day: 15 }).toString({ smallestUnit: 'microseconds' })
          }
        }];
        const { entries } = await testIndex.query(tenant, filters, { sortProperty: 'id' });

        expect(entries.length).to.equal(5);
      });

      it('supports prefixed range queries', async () => {
        const id = uuid();
        const doc = {
          id,
          value: 'foobar'
        };

        await testIndex.put(tenant, id, doc);

        const filters = [{
          value: {
            gte: 'foo'
          }
        }];

        const { entries } = await testIndex.query(tenant, filters, { sortProperty: 'id' });

        expect(entries.length).to.equal(1);
        expect(entries).to.include(id);
      });

      it('supports suffixed range queries', async () => {
        const id1 = uuid();
        const doc1 = {
          id  : id1,
          foo : 'bar'
        };

        const id2 = uuid();
        const doc2 = {
          id  : id2,
          foo : 'barbaz'
        };

        await testIndex.put(tenant, id1, doc1);
        await testIndex.put(tenant, id2, doc2);

        const filters = [{
          foo: {
            lte: 'bar'
          }
        }];

        const { entries } = await testIndex.query(tenant, filters, { sortProperty: 'id' });

        expect(entries.length).to.equal(1);
        expect(entries).to.include(id1);
      });

      it('treats strings differently', async () => {
        const id1 = uuid();
        const doc1 = {
          id  : id1,
          foo : true
        };

        const id2 = uuid();
        const doc2 = {
          id  : id2,
          foo : 'true'
        };

        await testIndex.put(tenant, id1, doc1);
        await testIndex.put(tenant, id2, doc2);

        const filters = [{
          foo: true
        }];

        const { entries } = await testIndex.query(tenant, filters, { sortProperty: 'id' });

        expect(entries.length).to.equal(1);
        expect(entries).to.include(id1);
      });

      describe('numbers', () => {

        const positiveDigits = Array(10).fill({}).map( _ => TestDataGenerator.randomInt(0, Number.MAX_SAFE_INTEGER)).sort((a,b) => a - b);
        const negativeDigits =
          Array(10).fill({}).map( _ => TestDataGenerator.randomInt(0, Number.MAX_SAFE_INTEGER) * -1).sort((a,b) => a - b);
        const testNumbers = Array.from(new Set([...negativeDigits, ...positiveDigits])); // unique numbers

        it('should return records that match provided number equality filter', async () => {
          const index = Math.floor(Math.random() * testNumbers.length);

          for (const digit of testNumbers) {
            await testIndex.put(tenant, digit.toString(), { digit });
          }

          const filters = [{
            digit: testNumbers.at(index)!
          }];

          const { entries } = await testIndex.query(tenant, filters, { sortProperty: 'digit' });

          expect(entries.length).to.equal(1);
          expect(entries.at(0)).to.equal(testNumbers.at(index)!.toString());
        });

        it ('should not return records that do not match provided number equality filter', async() => {
          // remove the potential (but unlikely) negative test result
          for (const digit of testNumbers.filter(n => n !== 1)) {
            await testIndex.put(tenant, digit.toString(), { digit });
          }

          const filters = [{ digit: 1 }];
          const { entries } = await testIndex.query(tenant, filters, { sortProperty: 'digit' });

          expect(entries.length).to.equal(0);
        });

        it('supports range queries with positive numbers inclusive', async () => {
          for (const digit of testNumbers) {
            await testIndex.put(tenant, digit.toString(), { digit });
          }

          const upperBound = positiveDigits.at(positiveDigits.length - 3)!;
          const lowerBound = positiveDigits.at(2)!;
          const filters = [{
            digit: {
              gte : lowerBound,
              lte : upperBound
            }
          }];

          const { entries } = await testIndex.query(tenant, filters, { sortProperty: 'digit' });

          const testResults = testNumbers.filter( n => n >= lowerBound && n <= upperBound).map(n => n.toString());
          expect(entries).to.eql(testResults);
        });

        it('supports range queries with negative numbers inclusive', async () => {
          for (const digit of testNumbers) {
            await testIndex.put(tenant, digit.toString(), { digit });
          }

          const upperBound = negativeDigits.at(negativeDigits.length - 2)!;
          const lowerBound = negativeDigits.at(2)!;

          const filters = [{
            digit: {
              gte : lowerBound,
              lte : upperBound
            }
          }];
          const { entries } = await testIndex.query(tenant, filters, { sortProperty: 'digit' });

          const testResults = testNumbers.filter( n => n >= lowerBound && n <= upperBound).map(n => n.toString());
          expect(entries).to.eql(testResults);
        });

        it('should return numbers gt a negative digit', async () => {
          for (const digit of testNumbers) {
            await testIndex.put(tenant, digit.toString(), { digit });
          }

          const lowerBound = negativeDigits.at(4)!;
          const filters = [{
            digit: {
              gt: lowerBound,
            }
          }];
          const { entries } = await testIndex.query(tenant, filters, { sortProperty: 'digit' });

          const testResults = testNumbers.filter( n => n > lowerBound).map(n => n.toString());
          expect(entries).to.eql(testResults);
        });

        it('should return numbers gt a digit', async () => {
          for (const digit of testNumbers) {
            await testIndex.put(tenant,digit.toString(), { digit });
          }

          const lowerBound = positiveDigits.at(4)!;

          const filters = [{
            digit: {
              gt: lowerBound,
            }
          }];

          const { entries } = await testIndex.query(tenant, filters, { sortProperty: 'digit' });
          const testResults = testNumbers.filter( n => n > lowerBound).map(n => n.toString());
          expect(entries).to.eql(testResults);
        });

        it('should return numbers lt a negative digit', async () => {
          for (const digit of testNumbers) {
            await testIndex.put(tenant,digit.toString(), { digit });
          }

          const upperBound = negativeDigits.at(4)!;

          const filters = [{
            digit: {
              lt: upperBound,
            }
          }];

          const { entries } = await testIndex.query(tenant, filters, { sortProperty: 'digit' });

          const testResults = testNumbers.filter( n => n < upperBound).map(n => n.toString());
          expect(entries).to.eql(testResults);
        });

        it('should return numbers lt a digit', async () => {
          for (const digit of testNumbers) {
            await testIndex.put(tenant,digit.toString(), { digit });
          }

          const upperBound = positiveDigits.at(4)!;

          const filters = [{
            digit: {
              lt: upperBound,
            }
          }];

          const { entries } = await testIndex.query(tenant, filters, { sortProperty: 'digit' });

          const testResults = testNumbers.filter( n => n < upperBound).map(n => n.toString());
          expect(entries).to.eql(testResults);
        });
      });

      describe('booleans', () => {
        it('should return records that match provided boolean equality filter', async () => {
          const itemTrueId = uuid();
          const boolTrueItem = {
            id        : itemTrueId,
            schema    : 'schema',
            published : true,
          };
          await testIndex.put(tenant, itemTrueId, boolTrueItem);

          const itemFalseId = uuid();
          const boolFalseItem = {
            id        : itemFalseId,
            schema    : 'schema',
            published : false,
          };
          await testIndex.put(tenant, itemFalseId, boolFalseItem);

          const bothFilter = [{ schema: 'schema' }];
          // control
          const { entries } = await testIndex.query(tenant, bothFilter, { sortProperty: 'id' });
          expect(entries.length).to.equal(2);
          expect(entries).to.have.members([ itemTrueId, itemFalseId ]);

          const trueFilter = [{ published: true, schema: 'schema' }];
          // equality true
          const respTrue = await testIndex.query(tenant, trueFilter, { sortProperty: 'id' });
          expect(respTrue.entries.length).to.equal(1);
          expect(respTrue.entries).to.have.members([ itemTrueId ]);

          const falseFilter = [{ published: false, schema: 'schema' }];
          // equality false
          const respFalse = await testIndex.query(tenant, falseFilter, { sortProperty: 'id' });
          expect(respFalse.entries.length).to.equal(1);
          expect(respFalse.entries).to.have.members([ itemFalseId ]);
        });
      });

      describe('sort, limit and cursor', () => {
        it('only returns the number of results specified by the limit property', async () => {
          const testVals = [ 'b', 'a', 'd', 'c'];
          for (const val of testVals) {
            await testIndex.put(tenant, val, { val, schema: 'schema' });
          }

          const filters = [{ schema: 'schema' }];

          // limit results without cursor
          let ascResults = await testIndex.query(tenant, filters, { sortProperty: 'val', limit: 2 });
          expect(ascResults.entries.length).to.equal(2);
          expect(ascResults.entries).to.eql(['a', 'b']);

          // limit results with a cursor
          ascResults = await testIndex.query(tenant, filters, { sortProperty: 'val', limit: 2, cursor: ascResults.cursor });
          expect(ascResults.entries.length).to.equal(2);
          expect(ascResults.entries).to.eql(['c', 'd']);
        });

        it('can sort by any indexed property', async () => {
          const testVals = ['b', 'd', 'c', 'a'];
          for (const val of testVals) {
            await testIndex.put(tenant, val, { val, schema: 'schema', index: testVals.indexOf(val) });
          }

          const filters = [{ schema: 'schema' }];

          // sort by value ascending
          const ascResults = await testIndex.query(tenant, filters, { sortProperty: 'val' });
          expect(ascResults.entries.length).to.equal(testVals.length);
          expect(ascResults.entries).to.eql(['a', 'b', 'c', 'd']);

          // sort by index ascending
          const ascIndexResults = await testIndex.query(tenant, filters, { sortProperty: 'index' });
          expect(ascIndexResults.entries.length).to.equal(testVals.length);
          expect(ascIndexResults.entries).eql(testVals);

          // sort by value descending
          const descResults = await testIndex.query(tenant, filters, { sortProperty: 'val', sortDirection: SortDirection.Descending });
          expect(descResults.entries.length).to.equal(testVals.length);
          expect(descResults.entries).to.eql(['d', 'c', 'b', 'a']);

          // sort by index descending
          const descIndexResults = await testIndex.query(tenant, filters, { sortProperty: 'index', sortDirection: SortDirection.Descending });
          expect(descIndexResults.entries.length).to.equal(testVals.length);
          expect(descIndexResults.entries).eql([...testVals].reverse());
        });

        it('sorts lexicographic', async () => {
          const testVals = [ 'b', 'a', 'd', 'c'];
          for (const val of testVals) {
            await testIndex.put(tenant, val, { val, schema: 'schema' });
          }
          const filters = [{ schema: 'schema' }];
          // sort ascending
          const ascResults = await testIndex.query(tenant, filters, { sortProperty: 'val' });
          expect(ascResults.entries.length).to.equal(4);
          expect(ascResults.entries).to.eql(['a', 'b', 'c', 'd']);

          // sort descending
          const descResults = await testIndex.query(tenant, filters, { sortProperty: 'val', sortDirection: SortDirection.Descending });
          expect(descResults.entries.length).to.equal(4);
          expect(descResults.entries).to.eql(['d', 'c', 'b', 'a']);
        });

        it('sorts numeric with and without a cursor', async () => {
          const testVals = [ -2, -1, 0, 1, 2 , 3 , 4 ];
          for (const val of testVals) {
            await testIndex.put(tenant, val.toString(), { val, schema: 'schema' });
          }

          const filters = [{ schema: 'schema' }];
          // sort ascending
          const ascResults = await testIndex.query(tenant, filters, { sortProperty: 'val' });
          expect(ascResults.entries.length).to.equal(testVals.length);
          expect(ascResults.entries).to.eql(['-2', '-1', '0', '1', '2' , '3' , '4']);

          // sort descending
          const descResults = await testIndex.query(tenant, filters, { sortProperty: 'val', sortDirection: SortDirection.Descending });
          expect(descResults.entries.length).to.eql(testVals.length);
          expect(descResults.entries).to.eql(['4', '3', '2', '1', '0' , '-1' , '-2']);
        });

        it('sorts range queries with or without a cursor', async () => {

          const testItems = [ 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h' ];

          for (const item of testItems) {
            await testIndex.put(tenant, item, { letter: item });
          }

          // test both upper and lower bounds
          const lowerBound = 'b';
          const upperBound = 'g';

          const bothBoundsFilters = [{
            letter: {
              gte : lowerBound,
              lte : upperBound
            },
          }];

          // ascending without a cursor
          let response = await testIndex.query(tenant, bothBoundsFilters, { sortProperty: 'letter', limit: 4 });
          expect(response.entries).to.eql(['b', 'c', 'd', 'e']);
          // ascending with a cursor
          response = await testIndex.query(tenant, bothBoundsFilters, { sortProperty: 'letter', cursor: response.cursor });
          expect(response.entries).to.eql([ 'f', 'g' ]); // should only return greater than e

          // descending without a cursor
          response = await testIndex.query(tenant, bothBoundsFilters, { sortProperty: 'letter', sortDirection: SortDirection.Descending, limit: 4 });
          expect(response.entries).to.eql(['g', 'f', 'e', 'd']);

          // descending with a cursor
          response = await testIndex.query(tenant, bothBoundsFilters, { sortProperty: 'letter', sortDirection: SortDirection.Descending, cursor: response.cursor });
          expect(response.entries).to.eql([ 'c', 'b' ]); // should only return less than d


          // test only upper bounds
          const upperBoundsFilters = [{
            letter: {
              lte: upperBound
            },
          }];

          // ascending without a cursor
          response = await testIndex.query(tenant, upperBoundsFilters, { sortProperty: 'letter', limit: 4 });
          expect(response.entries).to.eql(['a', 'b', 'c', 'd']);
          // ascending with a cursor
          response = await testIndex.query(tenant, upperBoundsFilters, { sortProperty: 'letter', cursor: response.cursor });
          expect(response.entries).to.eql([ 'e', 'f', 'g' ]); // should only return items greater than d

          // descending without a cursor
          response = await testIndex.query(tenant, upperBoundsFilters, { sortProperty: 'letter', sortDirection: SortDirection.Descending, limit: 4 });
          expect(response.entries).to.eql(['g', 'f', 'e', 'd' ]);

          // descending with a cursor
          response = await testIndex.query(tenant, upperBoundsFilters, { sortProperty: 'letter', sortDirection: SortDirection.Descending, cursor: response.cursor });
          expect(response.entries).to.eql([ 'c', 'b', 'a' ]); // should only return items less than c

          // test only lower bounds
          const lowerBoundsFilters = [{
            letter: {
              gte: lowerBound
            },
          }];

          // ascending without a cursor
          response = await testIndex.query(tenant, lowerBoundsFilters, { sortProperty: 'letter', limit: 4 });
          expect(response.entries).to.eql(['b', 'c', 'd', 'e']);

          // ascending with a cursor
          response = await testIndex.query(tenant, lowerBoundsFilters, { sortProperty: 'letter', cursor: response.cursor });
          expect(response.entries).to.eql([ 'f', 'g', 'h' ]); // should only return items greater than e

          // descending without a cursor
          response = await testIndex.query(tenant, lowerBoundsFilters, { sortProperty: 'letter', sortDirection: SortDirection.Descending, limit: 4 });
          expect(response.entries).to.eql(['h', 'g', 'f', 'e']);

          // descending with a cursor
          response = await testIndex.query(tenant, lowerBoundsFilters, { sortProperty: 'letter', sortDirection: SortDirection.Descending, cursor: response.cursor });
          expect(response.entries).to.eql([ 'd', 'c', 'b' ]); // should only return items less than e
        });

        it('sorts range queries negative integers with or without a cursor', async () => {
          const testNumbers = [ -5, -4, -3 , -2, -1, 0, 1, 2, 3, 4, 5 ];
          for (const digit of testNumbers) {
            await testIndex.put(tenant,digit.toString(), { digit });
          }

          const upperBound = 3;
          const lowerBound = -2;

          const filters = [{
            digit: {
              gte : lowerBound,
              lte : upperBound
            }
          }];

          let results = await testIndex.query(tenant,filters , { sortProperty: 'digit', limit: 4 });
          expect(results.entries).to.eql([ '-2', '-1', '0', '1' ]);

          results = await testIndex.query(tenant, filters, { sortProperty: 'digit', cursor: results.cursor });
          expect(results.entries).to.eql(['2', '3']);
        });

        it('sorts range queries with remaining results in lte after cursor', async () => {
          // create an array with unique IDs but multiple items representing the same digit.
          const testItems = [{
            id    : 'a',
            digit : 1,
          },{
            id    : 'b',
            digit : 2,
          }, {
            id    : 'c',
            digit : 3,
          }, {
            id    : 'd',
            digit : 4,
          }, {
            id    : 'e',
            digit : 4,
          },{
            id    : 'f',
            digit : 4,
          },{
            id    : 'g',
            digit : 4,
          },{
            id    : 'h',
            digit : 5,
          }];

          for (const item of testItems) {
            await testIndex.put(tenant, item.id, item);
          }

          const lowerBound = 2;
          const upperBound = 4;

          // with both lower and upper bounds
          // first issue with a limit
          let response = await testIndex.query(tenant, [{
            digit: {
              gte : lowerBound,
              lte : upperBound
            },
          }], { sortProperty: 'id', limit: 3 });
          expect(response.entries).to.eql([ 'b', 'c', 'd' ]);

          // this cursor should ony return results from the 'lte' part of the filter
          response = await testIndex.query(tenant, [{
            digit: {
              gte : lowerBound,
              lte : upperBound
            },
          }], { sortProperty: 'id', cursor: response.cursor });
          expect(response.entries).to.eql([ 'e', 'f', 'g' ]);

          // issue a range with no lower bounds but a limit
          response = await testIndex.query(tenant, [{
            digit: {
              lte: upperBound
            },
          }], { sortProperty: 'id', limit: 4 });
          expect(response.entries).to.eql([ 'a', 'b', 'c', 'd' ]);

          // with no lower bounds
          // ascending with a cursor
          // this cursor should ony return results from the 'lte' part of the filter
          response = await testIndex.query(tenant, [{
            digit: {
              lte: upperBound
            },
          }], { sortProperty: 'id', cursor: response.cursor });

          expect(response.entries).to.eql([ 'e', 'f', 'g']); // should only return three matching items
        });

        it('sorts OR queries with or without a cursor', async () => {
          const testValsSchema1 = ['a1', 'b1', 'c1', 'd1'];
          for (const val of testValsSchema1) {
            await testIndex.put(tenant, val, { val, schema: 'schema1' });
          }

          const testValsSchema2 = ['a2', 'b2', 'c2', 'd2'];
          for (const val of testValsSchema2) {
            await testIndex.put(tenant, val, { val, schema: 'schema2' });
          }

          const filters = [{
            schema: ['schema1', 'schema2']
          }];

          // sort ascending without cursor
          let results = await testIndex.query(tenant, filters, { sortProperty: 'val', limit: 4 });
          expect(results.entries).to.eql(['a1', 'a2', 'b1', 'b2']);

          // sort ascending from b2 onwards
          results = await testIndex.query(tenant, filters, { sortProperty: 'val', cursor: results.cursor });
          expect(results.entries).to.eql(['c1', 'c2', 'd1', 'd2']);
        });

        it('supports multiple filtered queries', async () => {
          const items:Array<{ val: string, digit: number, property: boolean }> = [];

          const lowerBounds = -2;
          const upperBounds = 3;

          // create 30 records with random digits between 1-9
          // every 3rd record should be a negative number
          // every 5th record a property should be set to true
          // every property not set to true should be set to false

          // we artificially use index #4 to be within the bounds of our query to be used as a cursor point.
          for (let i = 0; i < 30; i++) {

            const digit = i === 4 ? TestDataGenerator.randomInt(lowerBounds, upperBounds) :
              i % 3 === 0 ?
                TestDataGenerator.randomInt(1,9) * -1:
                TestDataGenerator.randomInt(1,9);

            const property = i % 5 === 0 ? true : false;

            const item = { val: IndexLevel.encodeNumberValue(i), digit, property };
            await testIndex.put(tenant, item.val, item);
            items.push(item);
          }

          // create the expected results;
          const compareResults = new Set([
            ...items.filter(i => i.digit >= lowerBounds && i.digit <= upperBounds),
            ...items.filter(i => i.property === true),
          ].sort((a,b) => lexicographicalCompare(a.val, b.val)).map(i => i.val));


          const filters:Filter[] = [
            { digit: { gte: lowerBounds, lte: upperBounds } },
            { property: true }
          ];

          // query in ascending order.
          const results = await testIndex.query(tenant, filters, { sortProperty: 'val', limit: 10 });
          expect(results.entries.length).to.be.lte(10);
          expect(results.entries).to.eql([...compareResults].slice(0, 10), 'results ascending');

          // query in ascending order with cursor.
          const resultsWithCursor = await testIndex.query(tenant, filters, { sortProperty: 'val', cursor: results.cursor });
          expect(resultsWithCursor.entries).to.eql([...compareResults].slice(10), 'results after cursor ascending');

          const descResults = await testIndex.query(tenant, filters, { sortProperty: 'val', sortDirection: SortDirection.Descending, limit: 10 });
          expect(descResults.entries.length).to.be.lte(10);
          expect(descResults.entries).to.eql([...compareResults].reverse().slice(0, 10), 'results descending');

          const descResultsAfterCursor = await testIndex.query(tenant, filters, { sortProperty: 'val', sortDirection: SortDirection.Descending, cursor: descResults.cursor });

          expect(descResultsAfterCursor.entries).to.eql([...compareResults].reverse().slice(10), 'results after cursor descending');
        });
      });
    });
  });

  describe('delete', () => {
    before(async () => {
      testIndex = new IndexLevel({
        createLevelDatabase,
        location: 'TEST-INDEX',
      });
      await testIndex.open();
    });

    beforeEach(async () => {
      await testIndex.clear();
    });

    after(async () => {
      await testIndex.close();
    });

    it('purges indexes', async () => {
      const id1 = uuid();
      const doc1 = {
        id  : id1,
        'a' : 'b',
        'c' : 'd'
      };

      const id2 = uuid();
      const doc2 = {
        id  : id2,
        'a' : 'b',
        'c' : 'd'
      };

      await testIndex.put(tenant, id1, doc1);
      await testIndex.put(tenant, id2, doc2);

      let result = await testIndex.query(tenant, [{ 'a': 'b', 'c': 'd' }], { sortProperty: 'id' });

      expect(result.entries.length).to.equal(2);
      expect(result.entries).to.contain(id1);

      await testIndex.delete(tenant, id1);

      result = await testIndex.query(tenant, [{ 'a': 'b', 'c': 'd' }], { sortProperty: 'id' });

      expect(result.entries.length).to.equal(1);

      await testIndex.delete(tenant, id2);

      const allKeys = await ArrayUtility.fromAsyncGenerator(testIndex.db.keys());
      expect(allKeys.length).to.equal(0);
    });

    it('should not delete anything if aborted beforehand', async () => {
      const controller = new AbortController();
      controller.abort('reason');

      const id = uuid();
      const doc = {
        id  : id,
        foo : 'bar'
      };

      await testIndex.put(tenant, id, doc);

      try {
        await testIndex.delete(tenant, id, { signal: controller.signal });
      } catch (e) {
        expect(e).to.equal('reason');
      }

      const result = await testIndex.query(tenant, [{ foo: 'bar' }], { sortProperty: 'id' });
      expect(result.entries.length).to.equal(1);
      expect(result.entries).to.contain(id);
    });

    it('does nothing when attempting to purge key that does not exist', async () => {
      const controller = new AbortController();
      controller.abort('reason');

      const id = uuid();
      const doc = {
        id  : id,
        foo : 'bar'
      };

      await testIndex.put(tenant, id, doc);

      // attempt purge an invalid id
      await testIndex.delete(tenant, 'invalid-id');

      const result = await testIndex.query(tenant, [{ foo: 'bar' }], { sortProperty: 'id' });
      expect(result.entries.length).to.equal(1);
      expect(result.entries).to.contain(id);
    });
  });

  describe('encodeValue', () => {
    it('should wrap string in quotes', async () => {
      expect(IndexLevel.encodeValue('test')).to.equal(`"test"`);
    });

    it('should return string encoded number using encodeNumberValue()', async () => {
      expect(IndexLevel.encodeValue(10)).to.equal(IndexLevel.encodeNumberValue(10));
    });

    it('should return stringified boolean', () => {
      expect(IndexLevel.encodeValue(true)).to.equal('true');
      expect(IndexLevel.encodeValue(false)).to.equal('false');
    });
  });

  describe('encodeNumberValue', () => {
    it('should encode positive digits and pad with leading zeros', () => {
      const expectedLength = String(Number.MAX_SAFE_INTEGER).length; //16
      const encoded = IndexLevel.encodeNumberValue(100);
      expect(encoded.length).to.equal(expectedLength);
      expect(encoded).to.equal('0000000000000100');
    });

    it('should encode negative digits as an offset with a prefix', () => {
      const expectedPrefix = '!';
      // expected length is maximum padding + the prefix.
      const expectedLength = (expectedPrefix + String(Number.MAX_SAFE_INTEGER)).length; //17
      const encoded = IndexLevel.encodeNumberValue(-100);
      expect(encoded.length).to.equal(String(Number.MIN_SAFE_INTEGER).length);
      expect(encoded.length).to.equal(expectedLength);
      expect(encoded).to.equal('!9007199254740891');
    });

    it('should encode digits to sort using lexicographical comparison', () => {
      const digits = [ -1000, -100, -10, 10, 100, 1000 ].sort((a,b) => a - b);
      const encodedDigits = digits.map(d => IndexLevel.encodeNumberValue(d))
        .sort((a,b) => lexicographicalCompare(a, b));

      digits.forEach((n,i) => expect(encodedDigits.at(i)).to.equal(IndexLevel.encodeNumberValue(n)));
    });
  });

  describe('encodeCursor', () => {
    it('encodes numbers strings and booleans', async () => {
      let cursor = IndexLevel.encodeCursor('itemId', 123); //number
      let expected = Encoder.stringToBase64Url(IndexLevel.keySegmentJoin('123', 'itemId'));
      expect(cursor).of.equal(expected);

      cursor = IndexLevel.encodeCursor('itemId', -123); //negative number
      expected = Encoder.stringToBase64Url(IndexLevel.keySegmentJoin('-123', 'itemId'));
      expect(cursor).of.equal(expected);

      cursor = IndexLevel.encodeCursor('itemId', 'string'); //string
      expected = Encoder.stringToBase64Url(IndexLevel.keySegmentJoin('"string"', 'itemId'));
      expect(cursor).of.equal(expected);

      cursor = IndexLevel.encodeCursor('itemId', true); // boolean
      expected = Encoder.stringToBase64Url(IndexLevel.keySegmentJoin('true', 'itemId'));
      expect(cursor).of.equal(expected);
    });
  });

  describe('decodeCursor', () => {
    it('decodes numbers strings and booleans', async () => {
      let cursor = IndexLevel.decodeCursor(Encoder.stringToBase64Url(IndexLevel.keySegmentJoin('123', 'itemId'))); //number
      expect(cursor.itemId).to.equal('itemId');
      expect(cursor.sortValue).to.equal(123);

      cursor = IndexLevel.decodeCursor(Encoder.stringToBase64Url(IndexLevel.keySegmentJoin('-123', 'itemId'))); // negative number
      expect(cursor.itemId).to.equal('itemId');
      expect(cursor.sortValue).to.equal(-123);

      cursor = IndexLevel.decodeCursor(Encoder.stringToBase64Url(IndexLevel.keySegmentJoin('"string"', 'itemId'))); // string
      expect(cursor.itemId).to.equal('itemId');
      expect(cursor.sortValue).to.equal('string');

      cursor = IndexLevel.decodeCursor(Encoder.stringToBase64Url(IndexLevel.keySegmentJoin('true', 'itemId'))); // boolean
      expect(cursor.itemId).to.equal('itemId');
      expect(cursor.sortValue).to.equal(true);
    });

    it('throws for unknown types', async () => {
      expect(IndexLevel.decodeCursor.bind(IndexLevel,
        Encoder.stringToBase64Url(IndexLevel.keySegmentJoin('{}', 'itemId')))
      ).to.throw(DwnErrorCode.IndexInvalidCursorValueType); // object
      expect(IndexLevel.decodeCursor.bind(IndexLevel,
        Encoder.stringToBase64Url(IndexLevel.keySegmentJoin('[]', 'itemId')))
      ).to.throw(DwnErrorCode.IndexInvalidCursorValueType); // array
      expect(IndexLevel.decodeCursor.bind(IndexLevel,
        Encoder.stringToBase64Url(IndexLevel.keySegmentJoin('null', 'itemId')))
      ).to.throw(DwnErrorCode.IndexInvalidCursorValueType); // null
      expect(IndexLevel.decodeCursor.bind(IndexLevel,
        Encoder.stringToBase64Url(IndexLevel.keySegmentJoin('-', 'itemId')))
      ).to.throw(DwnErrorCode.IndexInvalidCursorValueType); // invalid json
    });
  });

  describe('isFilterConcise', () => {
    const queryOptionsWithCursor = { sortProperty: 'sort', cursor: 'cursor' };
    const queryOptionsWithoutCursor = { sortProperty: 'sort' };

    it('recordId is always concise', async () => {
      expect(IndexLevel.isFilterConcise({ recordId: 'record-id' }, queryOptionsWithCursor)).to.equal(true);
      expect(IndexLevel.isFilterConcise({ recordId: 'record-id' }, queryOptionsWithoutCursor)).to.equal(true);
    });

    it('other than if `recordId` exists, if a cursor exists it is never concise', async () => {
      expect(IndexLevel.isFilterConcise({ schema: 'schema', contextId: 'contextId', parentId: 'parentId' }, queryOptionsWithCursor)).to.equal(false);

      // control
      expect(IndexLevel.isFilterConcise({ schema: 'schema', contextId: 'contextId', parentId: 'parentId' }, queryOptionsWithoutCursor)).to.equal(true);
      expect(IndexLevel.isFilterConcise({ recordId: 'record-id' }, queryOptionsWithCursor)).to.equal(true);
    });

    it('if there is no cursor -  protocolPath, contextId, parentId, or schema return a concise filter', async () => {
      expect(IndexLevel.isFilterConcise({ protocolPath: 'protocolPath' }, queryOptionsWithoutCursor)).to.equal(true);
      expect(IndexLevel.isFilterConcise({ protocolPath: 'protocolPath' }, queryOptionsWithCursor)).to.equal(false); // control

      expect(IndexLevel.isFilterConcise({ contextId: 'contextId' }, queryOptionsWithoutCursor)).to.equal(true);
      expect(IndexLevel.isFilterConcise({ contextId: 'contextId' }, queryOptionsWithCursor)).to.equal(false); // control

      expect(IndexLevel.isFilterConcise({ contextId: 'parentId' }, queryOptionsWithoutCursor)).to.equal(true);
      expect(IndexLevel.isFilterConcise({ contextId: 'parentId' }, queryOptionsWithCursor)).to.equal(false); // control

      expect(IndexLevel.isFilterConcise({ contextId: 'schema' }, queryOptionsWithoutCursor)).to.equal(true);
      expect(IndexLevel.isFilterConcise({ contextId: 'schema' }, queryOptionsWithCursor)).to.equal(false); // control
    });

    it('if there is no cursor, and it is not one of the conditions, return not concise', async () => {
      expect(IndexLevel.isFilterConcise({ dataSize: { gt: 123 } }, queryOptionsWithoutCursor)).to.equal(false);

      // control
      expect(IndexLevel.isFilterConcise({ schema: 'schema', contextId: 'contextId', parentId: 'parentId' }, queryOptionsWithoutCursor)).to.equal(true);
    });

    it('if protocol filter exists by itself it is not a concise filter', async () => {
      expect(IndexLevel.isFilterConcise({ protocol: 'protocol' }, queryOptionsWithoutCursor)).to.equal(false);

      // control
      expect(IndexLevel.isFilterConcise({ protocol: 'protocol', protocolPath: 'path/to' }, queryOptionsWithoutCursor)).to.equal(true);
    });
  });
});