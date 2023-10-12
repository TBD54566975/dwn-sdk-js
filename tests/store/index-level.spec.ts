import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { ArrayUtility } from '../../src/utils/array.js';
import { IndexLevel } from '../../src/store/index-level.js';
import { lexicographicalCompare } from '../../src/utils/string.js';
import { monotonicFactory } from 'ulidx';
import { SortOrder } from '../../src/index.js';
import { Temporal } from '@js-temporal/polyfill';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { v4 as uuid } from 'uuid';
import { createLevelDatabase, LevelWrapper } from '../../src/store/level-wrapper.js';

chai.use(chaiAsPromised);


describe('IndexLevel', () => {
  let db: LevelWrapper<string>;
  let testIndex: IndexLevel<string>;
  let partitionedDB: LevelWrapper<string>;
  const ulidFactory = monotonicFactory();
  const tenant = 'did:alice:index-test';

  describe('put', () => {
    before(async () => {
      db = new LevelWrapper<string>({
        createLevelDatabase,
        location      : 'TEST-INDEX',
        valueEncoding : 'utf8'
      });
      testIndex = new IndexLevel(db);
      partitionedDB = await (await db.partition(tenant)).partition('index');
      await db.open();
    });

    beforeEach(async () => {
      await db.clear();
    });

    after(async () => {
      await db.close();
    });

    it('fails to index with no sorting properties', async () => {
      const id = uuid();

      let failedIndex = testIndex.index(tenant, id, id, id, {
        foo: 'foo'
      }, { nested: {} });

      await expect(failedIndex).to.eventually.be.rejectedWith('must include at least one sorted index');

      failedIndex = testIndex.index(tenant, id, id, id, {
        foo: 'foo'
      }, { sort: [ [] ] });

      await expect(failedIndex).to.eventually.be.rejectedWith('must include at least one sorted index');

      const keys = await ArrayUtility.fromAsyncGenerator(partitionedDB.keys());
      expect(keys.length).to.equal(0);

      failedIndex = testIndex.index(tenant, id, id, id, {
        foo: 'foo'
      }, { sort: id });
      await expect(failedIndex).to.eventually.not.be.rejected;
    });

    it('fails to index with no indexable properties ', async () => {
      const id = uuid();

      let failedIndex = testIndex.index(tenant, id, id, id, {}, { id });
      await expect(failedIndex).to.eventually.be.rejectedWith('must include at least one indexable property');

      failedIndex = testIndex.index(tenant, id, id, id, {
        empty: [ [] ]
      }, { id });
      await expect(failedIndex).to.eventually.be.rejectedWith('must include at least one indexable property');

      failedIndex = testIndex.index(tenant, id, id, id, {
        foo : {},
        bar : {
          baz: {},
        }
      }, { id });

      await expect(failedIndex).to.eventually.be.rejectedWith('must include at least one indexable property');

      const keys = await ArrayUtility.fromAsyncGenerator(partitionedDB.keys());
      expect(keys.length).to.equal(0);

      failedIndex = testIndex.index(tenant, id, id, id, {
        foo : 'foo',
        bar : {
          baz: 'baz'
        }
      }, { id });
      await expect(failedIndex).to.eventually.not.be.rejected;
    });

    it('flattens nested indexes', async () => {
      const id = uuid();
      const index = {
        some: {
          nested: {
            object: true
          }
        }
      };
      await testIndex.index(tenant, id, id, id, index, { id });
      const indexKey = testIndex['constructIndexedKey'](
        `__id`,
        'some.nested.object',
        'true',
        `"${id}"`,
        id,
      );
      const key = await partitionedDB.get(indexKey);
      expect(key).to.not.be.undefined;
      expect(JSON.parse(key!)).to.equal(id);
    });

    it('adds 1 key per property, per sorted property, aside from id and reverse lookup', async () => {
      const id = uuid();
      const dateCreated = new Date().toISOString();

      await testIndex.index(tenant, id, id, id, {
        'a' : 'b', // 1
        'c' : 'd', // 1
        dateCreated, // 1
      }, { dateCreated });

      let keys = await ArrayUtility.fromAsyncGenerator(partitionedDB.keys());
      expect(keys.length).to.equal(5);

      await partitionedDB.clear();

      const watermark = ulidFactory();
      await testIndex.index(tenant, id, id, id, {
        'a' : 'b', // 2
        'c' : 'd', // 2
        dateCreated, // 2
      }, { dateCreated, watermark });

      keys = await ArrayUtility.fromAsyncGenerator(partitionedDB.keys());
      expect(keys.length).to.equal(8);
    });

    it('should not put anything if aborted beforehand', async () => {
      const controller = new AbortController();
      controller.abort('reason');

      const id = uuid();
      const index = {
        foo: 'bar'
      };

      const indexPromise = testIndex.index(tenant, id, id, id, index, { id }, { signal: controller.signal });
      await expect(indexPromise).to.eventually.rejectedWith('reason');

      const result = await testIndex.query(
        tenant,
        [{ filter: { foo: 'bar' }, sort: 'id', sortDirection: SortOrder.Ascending }]
      );
      expect(result.length).to.equal(0);
    });
  });

  describe('query', () => {
    before(async () => {
      db = new LevelWrapper<string>({
        createLevelDatabase,
        location      : 'TEST-INDEX',
        valueEncoding : 'utf8'
      });
      testIndex = new IndexLevel(db);
      partitionedDB = await (await db.partition(tenant)).partition('index');
      await db.open();
    });

    beforeEach(async () => {
      await db.clear();
    });

    after(async () => {
      await db.close();
    });

    it('works', async () =>{
      const id1 = uuid();
      const doc1 = {
        'a' : 'b',
        'c' : 'd'
      };

      const id2 = uuid();
      const doc2 = {
        'a' : 'c',
        'c' : 'd'
      };

      const id3 = uuid();
      const doc3 = {
        'a' : 'b',
        'c' : 'e'
      };

      await testIndex.index(tenant, id1, id1, id1, doc1, { id: id1 });
      await testIndex.index(tenant, id2, id2, id2, doc2, { id: id2 });
      await testIndex.index(tenant, id3, id3, id3, doc3, { id: id3 });

      const result = await testIndex.query(tenant, [{ filter: {
        'a' : 'b',
        'c' : 'e'
      }, sort: 'id', sortDirection: SortOrder.Ascending }]);

      expect(result.length).to.equal(1);
      expect(result[0]).to.equal(id3);
    });

    it('should not match values prefixed with the query', async () => {
      const id = uuid();
      const doc = {
        value: 'foobar'
      };

      await testIndex.index(tenant, id, id, id, doc, { id });

      const resp = await testIndex.query(tenant, [{ filter: {
        value: 'foo'
      }, sort: 'id', sortDirection: SortOrder.Ascending }]);

      expect(resp.length).to.equal(0);
    });

    it('supports OR queries', async () => {
      const id1 = uuid();
      const doc1 = {
        'a': 'a'
      };

      const id2 = uuid();
      const doc2 = {
        'a': 'b'
      };

      const id3 = uuid();
      const doc3 = {
        'a': 'c'
      };

      await testIndex.index(tenant, id1, id1, id1, doc1, { id: id1 });
      await testIndex.index(tenant, id2, id2, id2, doc2, { id: id2 });
      await testIndex.index(tenant, id3, id3, id3, doc3, { id: id3 });

      const resp = await testIndex.query(tenant, [{ filter: {
        a: [ 'a', 'b' ]
      }, sort: 'id', sortDirection: SortOrder.Ascending }]);

      expect(resp.length).to.equal(2);
      expect(resp).to.include(id1);
      expect(resp).to.include(id2);
    });

    it('supports range queries', async () => {
      for (let i = -5; i < 5; ++i) {
        const id = uuid();
        const doc = {
          dateCreated: Temporal.PlainDateTime.from({ year: 2023, month: 1, day: 15 + i }).toString({ smallestUnit: 'microseconds' })
        };

        await testIndex.index(tenant, id, id, id, doc, { id });
      }

      const resp = await testIndex.query(tenant, [{ filter: {
        dateCreated: {
          gte: Temporal.PlainDateTime.from({ year: 2023, month: 1, day: 15 }).toString({ smallestUnit: 'microseconds' })
        }
      }, sort: 'id', sortDirection: SortOrder.Ascending }]);

      expect(resp.length).to.equal(5);
    });

    it('supports prefixed range queries', async () => {
      const id = uuid();
      const doc = {
        value: 'foobar'
      };

      await testIndex.index(tenant, id, id, id, doc, { id });

      const resp = await testIndex.query(tenant, [{ filter: {
        value: {
          gte: 'foo'
        }
      }, sort: 'id', sortDirection: SortOrder.Ascending }]);

      expect(resp.length).to.equal(1);
      expect(resp).to.include(id);
    });

    it('supports suffixed range queries', async () => {
      const id1 = uuid();
      const doc1 = {
        foo: 'bar'
      };

      const id2 = uuid();
      const doc2 = {
        foo: 'barbaz'
      };

      await testIndex.index(tenant, id1, id1, id1, doc1, { id: id1 });
      await testIndex.index(tenant, id2, id2, id2, doc2, { id: id2 });

      const resp = await testIndex.query(tenant, [{ filter: {
        foo: {
          lte: 'bar'
        }
      }, sort: 'id', sortDirection: SortOrder.Ascending }]);

      expect(resp.length).to.equal(1);
      expect(resp).to.include(id1);
    });

    it('treats strings differently', async () => {
      const id1 = uuid();
      const doc1 = {
        foo: true
      };

      const id2 = uuid();
      const doc2 = {
        foo: 'true'
      };

      await testIndex.index(tenant, id1, id1, id1, doc1, { id: id1 });
      await testIndex.index(tenant, id2, id2, id2, doc2, { id: id2 });

      const resp = await testIndex.query(tenant, [{ filter: {
        foo: true
      }, sort: 'id', sortDirection: SortOrder.Ascending }]);

      expect(resp.length).to.equal(1);
      expect(resp).to.include(id1);
    });

    describe('numbers', () => {

      const positiveDigits = Array(10).fill({}).map( _ => TestDataGenerator.randomInt(0, Number.MAX_SAFE_INTEGER)).sort((a,b) => a - b);
      const negativeDigits =
        Array(10).fill({}).map( _ => TestDataGenerator.randomInt(0, Number.MAX_SAFE_INTEGER) * -1).sort((a,b) => a - b);
      const testNumbers = Array.from(new Set([...positiveDigits, ...negativeDigits])); // unique numbers

      it('should return records that match provided number equality filter', async () => {
        const index = Math.floor(Math.random() * testNumbers.length);

        for (const digit of testNumbers) {
          await testIndex.index(tenant, digit.toString(), digit.toString(), digit.toString(), { digit }, { digit });
        }

        const resp = await testIndex.query(tenant, [{ filter: {
          digit: testNumbers.at(index)!
        }, sort: 'digit', sortDirection: SortOrder.Ascending }]);

        expect(resp.length).to.equal(1);
        expect(resp.at(0)).to.equal(testNumbers.at(index)!.toString());
      });

      it ('should not return records that do not match provided number equality filter', async() => {
        // remove the potential (but unlikely) negative test result
        for (const digit of testNumbers.filter(n => n !== 1)) {
          await testIndex.index(tenant, digit.toString(), digit.toString(), digit.toString(), { digit }, { digit });
        }
        const resp = await testIndex.query(tenant, [{ filter: {
          digit: 1
        }, sort: 'digit', sortDirection: SortOrder.Ascending }]);

        expect(resp.length).to.equal(0);
      });

      it('supports range queries with positive numbers inclusive', async () => {
        for (const digit of testNumbers) {
          await testIndex.index(tenant, digit.toString(), digit.toString(), digit.toString(), { digit }, { digit });
        }

        const upperBound = positiveDigits.at(positiveDigits.length - 3)!;
        const lowerBound = positiveDigits.at(2)!;
        const resp = await testIndex.query(tenant, [{ filter: {
          digit: {
            gte : lowerBound,
            lte : upperBound
          }
        }, sort: 'digit', sortDirection: SortOrder.Ascending }]);

        const testResults = testNumbers.filter( n => n >= lowerBound && n <= upperBound).map(n => n.toString());
        expect(resp.sort()).to.eql(testResults.sort());
      });

      it('supports range queries with negative numbers inclusive', async () => {
        for (const digit of testNumbers) {
          await testIndex.index(tenant, digit.toString(), digit.toString(), digit.toString(), { digit }, { digit });
        }

        const upperBound = negativeDigits.at(negativeDigits.length - 2)!;
        const lowerBound = negativeDigits.at(2)!;
        const resp = await testIndex.query(tenant, [{ filter: {
          digit: {
            gte : lowerBound,
            lte : upperBound
          }
        }, sort: 'digit', sortDirection: SortOrder.Ascending }]);

        const testResults = testNumbers.filter( n => n >= lowerBound && n <= upperBound).map(n => n.toString());
        expect(resp.sort()).to.eql(testResults.sort());
      });

      it('should return numbers gt a negative digit', async () => {
        for (const digit of testNumbers) {
          await testIndex.index(tenant, digit.toString(), digit.toString(), digit.toString(), { digit }, { digit });
        }

        const lowerBound = negativeDigits.at(4)!;

        const resp = await testIndex.query(tenant, [{ filter: {
          digit: {
            gt: lowerBound,
          }
        }, sort: 'digit', sortDirection: SortOrder.Ascending }]);

        const testResults = testNumbers.filter( n => n > lowerBound).map(n => n.toString());
        expect(resp.sort()).to.eql(testResults.sort());
      });

      it('should return numbers gt a digit', async () => {
        for (const digit of testNumbers) {
          await testIndex.index(tenant, digit.toString(), digit.toString(), digit.toString(), { digit }, { digit });
        }

        const lowerBound = positiveDigits.at(4)!;

        const resp = await testIndex.query(tenant, [{ filter: {
          digit: {
            gt: lowerBound,
          }
        }, sort: 'digit', sortDirection: SortOrder.Ascending }]);

        const testResults = testNumbers.filter( n => n > lowerBound).map(n => n.toString());
        expect(resp.sort()).to.eql(testResults.sort());
      });

      it('should return numbers lt a negative digit', async () => {
        for (const digit of testNumbers) {
          await testIndex.index(tenant, digit.toString(), digit.toString(), digit.toString(), { digit }, { digit });
        }

        const upperBound = negativeDigits.at(4)!;

        const resp = await testIndex.query(tenant, [{ filter: {
          digit: {
            lt: upperBound,
          }
        }, sort: 'digit', sortDirection: SortOrder.Ascending }]);

        const testResults = testNumbers.filter( n => n < upperBound).map(n => n.toString());
        expect(resp.sort()).to.eql(testResults.sort());
      });

      it('should return numbers lt a digit', async () => {
        for (const digit of testNumbers) {
          await testIndex.index(tenant, digit.toString(), digit.toString(), digit.toString(), { digit }, { digit });
        }

        const upperBound = positiveDigits.at(4)!;

        const resp = await testIndex.query(tenant, [{ filter: {
          digit: {
            lt: upperBound,
          }
        }, sort: 'digit', sortDirection: SortOrder.Ascending }]);

        const testResults = testNumbers.filter( n => n < upperBound).map(n => n.toString());
        expect(resp.sort()).to.eql(testResults.sort());
      });
    });
  });

  describe('delete', () => {
    before(async () => {
      db = new LevelWrapper<string>({
        createLevelDatabase,
        location      : 'TEST-INDEX',
        valueEncoding : 'utf8'
      });
      testIndex = new IndexLevel(db);
      partitionedDB = await (await db.partition(tenant)).partition('index');
      await db.open();
    });

    beforeEach(async () => {
      await db.clear();
    });

    after(async () => {
      await db.close();
    });

    it('purges indexes', async () => {
      const id1 = uuid();
      const doc1 = {
        'a' : 'b',
        'c' : 'd'
      };

      const id2 = uuid();
      const doc2 = {
        'a' : 'b',
        'c' : 'd'
      };

      await testIndex.index(tenant, id1, id1, id1, doc1, { id: id1 });
      await testIndex.index(tenant, id2, id2, id2, doc2, { id: id2 });

      let result = await testIndex.query(tenant, [{ filter: { 'a': 'b', 'c': 'd' }, sort: 'id', sortDirection: SortOrder.Ascending }]);

      expect(result.length).to.equal(2);
      expect(result).to.contain(id1);

      await testIndex.delete(tenant, id1);

      result = await testIndex.query(tenant, [{ filter: { 'a': 'b', 'c': 'd' }, sort: 'id', sortDirection: SortOrder.Ascending }]);

      expect(result.length).to.equal(1);

      await testIndex.delete(tenant, id2);

      const allKeys = await ArrayUtility.fromAsyncGenerator(db.keys());
      expect(allKeys.length).to.equal(0);
    });

    it('should not delete anything if aborted beforehand', async () => {
      const controller = new AbortController();
      controller.abort('reason');

      const id = uuid();
      const doc = {
        foo: 'bar'
      };

      await testIndex.index(tenant, id, id, id, doc, { id });

      try {
        await testIndex.delete(tenant, id, { signal: controller.signal });
      } catch (e) {
        expect(e).to.equal('reason');
      }

      const result = await testIndex.query(tenant, [{ filter: { foo: 'bar' }, sort: 'id', sortDirection: SortOrder.Ascending }]);
      expect(result.length).to.equal(1);
      expect(result).to.contain(id);
    });

    it('does nothing when attempting to purge key that does not exist', async () => {
      const controller = new AbortController();
      controller.abort('reason');

      const id = uuid();
      const doc = {
        foo: 'bar'
      };

      await testIndex.index(tenant, id, id, id, doc, { id });

      // attempt purge an invalid id
      await testIndex.delete(tenant, 'invalid-id');

      const result = await testIndex.query(tenant, [{ filter: { foo: 'bar' }, sort: 'id', sortDirection: SortOrder.Ascending }]);
      expect(result.length).to.equal(1);
      expect(result).to.contain(id);
    });
  });

  describe('sort and cursor', () => {
    before(async () => {
      db = new LevelWrapper<string>({
        createLevelDatabase,
        location      : 'TEST-INDEX',
        valueEncoding : 'utf8'
      });
      testIndex = new IndexLevel(db);
      partitionedDB = await (await db.partition(tenant)).partition('index');
      await db.open();
    });

    beforeEach(async () => {
      await db.clear();
    });

    after(async () => {
      await db.close();
    });

    it('invalid sort property returns no results', async () => {
      const testVals = ['b', 'd', 'c', 'a'];
      for (const val of testVals) {
        await testIndex.index(tenant, val, val, val, { val, schema: 'schema' }, { val });
      }

      // sort by invalid property returns no results
      const invalidResults = await testIndex.query(tenant, [{ filter: { schema: 'schema' }, sort: 'invalid', sortDirection: SortOrder.Ascending }]);
      expect(invalidResults.length).to.equal(0);
    });

    it('can have multiple sort properties', async () => {
      const testVals = ['b', 'd', 'c', 'a'];
      for (const val of testVals) {
        await testIndex.index(tenant, val, val, val, { val, schema: 'schema' }, { val, index: testVals.indexOf(val) });
      }

      // sort by value
      const ascResults = await testIndex.query(tenant, [{ filter: { schema: 'schema' }, sort: 'val', sortDirection: SortOrder.Ascending }]);
      expect(ascResults.length).to.equal(testVals.length);
      expect(ascResults).to.eql(['a', 'b', 'c', 'd']);

      // sort by index
      const ascIndexResults = await testIndex.query(tenant, [{ filter: { schema: 'schema' }, sort: 'index', sortDirection: SortOrder.Ascending }]);
      expect(ascIndexResults.length).to.equal(testVals.length);
      expect(ascIndexResults).to.eql(testVals);
    });

    it('sorts lexicographic ascending using a cursor', async () => {
      const testVals = ['a', 'b', 'c', 'd'];
      for (const val of testVals) {
        await testIndex.index(tenant, val, val, val, { val, schema: 'schema' }, { val });
      }

      // sort ascending
      const ascResults = await testIndex.query(tenant, [{ filter: { schema: 'schema' }, sort: 'val', sortDirection: SortOrder.Ascending, cursor: 'b' }]);
      expect(ascResults.length).to.equal(2);
      expect(ascResults[0]).to.equal('c');
      expect(ascResults[1]).to.equal('d');
    });

    it('sorts lexicographic descending', async () => {
      const testVals = ['d', 'c', 'b', 'a'];
      for (const val of testVals) {
        await testIndex.index(tenant, val, val, val, { val, schema: 'schema' }, { val });
      }

      // sort descending
      const descResults = await testIndex.query(tenant, [{ filter: { schema: 'schema' }, sort: 'val', sortDirection: SortOrder.Descending }]);
      expect(descResults.length).to.equal(testVals.length);
      descResults.forEach((r,i) => expect(testVals[i]).to.equal(r));
    });

    it('sorts lexicographic descending using a cursor', async () => {
      const testVals = ['a', 'b', 'c', 'd'];
      for (const val of testVals) {
        await testIndex.index(tenant, val, val, val, { val, schema: 'schema' }, { val });
      }

      // sort descending
      const descResults = await testIndex.query(tenant, [{ filter: { schema: 'schema' }, sort: 'val', sortDirection: SortOrder.Descending, cursor: 'b' }]);
      expect(descResults.length).to.equal(2);
      expect(descResults[0]).to.equal('d');
      expect(descResults[1]).to.equal('c');
    });

    it('sorts range queries', async () => {
      const testNumbers = [ 1 ,2 ,3 ,4 ,5, 6, 7, 8, 9, 10 ];
      for (const digit of testNumbers) {
        await testIndex.index(tenant, digit.toString(), digit.toString(), digit.toString(), { digit }, { digit });
      }

      const upperBound = 9;
      const lowerBound = 2;
      const resp = await testIndex.query(tenant, [{ filter: {
        digit: {
          gte : lowerBound,
          lte : upperBound
        }
      }, sort: 'digit', sortDirection: SortOrder.Descending, cursor: '5' }]);

      const testResults = testNumbers.slice(5)
        .filter( n => n >= lowerBound && n <= upperBound!).map(n => n.toString())
        .reverse();
      expect(resp.sort()).to.eql(testResults.sort());
    });

    it('sorts range queries negative integers', async () => {
      const testNumbers = [ -5, -4, -3 , -2, -1, 0, 1, 2, 3, 4, 5 ];
      for (const digit of testNumbers) {
        await testIndex.index(tenant, digit.toString(), digit.toString(), digit.toString(), { digit }, { digit });
      }

      const upperBound = 3;
      const lowerBound = -2;
      const resp = await testIndex.query(tenant, [{ filter: {
        digit: {
          gte : lowerBound,
          lte : upperBound
        }
      }, sort: 'digit', sortDirection: SortOrder.Descending, cursor: '-2' }]);

      const testResults = testNumbers.slice(4)
        .filter( n => n >= lowerBound && n <= upperBound!).map(n => n.toString())
        .reverse();
      expect(resp.sort()).to.eql(testResults.sort());
    });

    it('sorts numeric ascending', async () => {
      const testVals = [ 1, 2 , 3 , 4 ];
      for (const val of testVals) {
        await testIndex.index(tenant, val.toString(), val.toString(), val.toString(), { val, schema: 'schema' }, { val });
      }

      // sort ascending
      const ascResults = await testIndex.query(tenant, [{ filter: { schema: 'schema' }, sort: 'val', sortDirection: SortOrder.Ascending }]);
      expect(ascResults.length).to.equal(testVals.length);
      ascResults.forEach((r,i) => expect(testVals[i].toString()).to.equal(r));
    });

    it('sorts numeric descending', async () => {
      const testVals = [ 4, 3, 2, 1 ];
      for (const val of testVals) {
        await testIndex.index(tenant, val.toString(), val.toString(), val.toString(), { val, schema: 'schema' }, { val });
      }

      // sort descending
      const descResults = await testIndex.query(tenant, [{ filter: { schema: 'schema' }, sort: 'val', sortDirection: SortOrder.Descending }]);
      expect(descResults.length).to.equal(testVals.length);
      descResults.forEach((r,i) => expect(testVals[i].toString()).to.equal(r));
    });

    it('supports sort and cursor with OR queries', async () => {
      const testValsSchema1 = ['a1', 'b1', 'c1', 'd1'];
      for (const val of testValsSchema1) {
        await testIndex.index(tenant, val, val, val, { val, schema: 'schema1' }, { val });
      }
      const testValsSchema2 = ['a2', 'b2', 'c2', 'd2'];
      for (const val of testValsSchema2) {
        await testIndex.index(tenant, val, val, val, { val, schema: 'schema1' }, { val });
      }

      // sort ascending from b2 onwards
      const ascResults = await testIndex.query(tenant, [{ filter: { schema: ['schema1', 'schema2'] }, sort: 'val', sortDirection: SortOrder.Ascending, cursor: 'b2' }]);
      expect(ascResults.length).to.equal(4);
      expect(ascResults[0]).to.equal('c1');
      expect(ascResults[1]).to.equal('c2');
      expect(ascResults[2]).to.equal('d1');
      expect(ascResults[3]).to.equal('d2');
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
});