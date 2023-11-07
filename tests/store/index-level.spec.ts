import { ArrayUtility } from '../../src/utils/array.js';
import { createLevelDatabase } from '../../src/store/level-wrapper.js';
import { IndexLevel } from '../../src/store/index-level.js';
import { lexicographicalCompare } from '../../src/utils/string.js';
import { SortDirection } from '../../src/index.js';
import { Temporal } from '@js-temporal/polyfill';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { v4 as uuid } from 'uuid';

import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

chai.use(chaiAsPromised);


describe('IndexLevel', () => {
  let testIndex: IndexLevel<string>;
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
      it('ignores empty nested arrays', async () => {
        const id = uuid();
        const failedIndexPromise = testIndex.put(tenant, id, id, {
          empty: [ [] ]
        });
        await expect(failedIndexPromise).to.eventually.be.rejectedWith('must include at least one indexable property');
      });

      it('ignores empty index object', async () => {
        const id = uuid();

        let failedIndexPromise = testIndex.put(tenant, id, id, {});
        await expect(failedIndexPromise).to.eventually.be.rejectedWith('must include at least one indexable property');

        failedIndexPromise = testIndex.put(tenant, id, id, {
          foo : {},
          bar : {
            baz: {},
          }
        });
        await expect(failedIndexPromise).to.eventually.be.rejectedWith('must include at least one indexable property');
      });

      it('ignores undefined indexes', async () => {
        const id = uuid();
        const failedIndexPromise = testIndex.put(tenant, id, id, {
          some: {
            undefined: {
              value: undefined,
            }
          }
        });
        await expect(failedIndexPromise).to.eventually.be.rejectedWith('must include at least one indexable property');
      });
    });

    it('successfully indexes', async () => {
      const id = uuid();
      const successfulIndex = testIndex.put(tenant, id, id, {
        id,
        foo : 'foo',
        bar : {
          baz: 'baz'
        }
      });
      await expect(successfulIndex).to.eventually.not.be.rejected;
      const results = await testIndex.query(tenant, [{ id: id }], { sortProperty: 'id' });
      expect(results[0]).to.equal(id);
    });

    it('flattens nested indexes', async () => {
      const id = uuid();

      await testIndex.put(tenant, id, id, {
        id,
        nested: {
          data: true
        }
      });

      const id2 = uuid();
      await testIndex.put(tenant, id2, id2, { notNested: true, id });

      const results = await testIndex.query(tenant, [{ 'nested.data': true }], { sortProperty: 'id' });
      expect(results.length).to.equal(1);
      expect(results[0]).to.equal(id);
    });

    it('adds one index key per property, aside from id', async () => {
      const id = uuid();
      const dateCreated = new Date().toISOString();

      await testIndex.put(tenant, id, id, {
        'a' : 'b', // 1 key
        'c' : 'd', // 1 key
        dateCreated, // 1 key
      });

      let keys = await ArrayUtility.fromAsyncGenerator(testIndex.db.keys());
      expect(keys.length).to.equal(4);

      await testIndex.clear();

      await testIndex.put(tenant, id, id, {
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

      const indexPromise = testIndex.put(tenant, id, id, index, { signal: controller.signal });
      await expect(indexPromise).to.eventually.rejectedWith('reason');

      const result = await testIndex.query(tenant, [{ foo: 'bar' }], { sortProperty: 'id' });
      expect(result.length).to.equal(0);
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

      await testIndex.put(tenant, id1, id1, doc1);
      await testIndex.put(tenant, id2, id2, doc2);
      await testIndex.put(tenant, id3, id3, doc3);

      const result = await testIndex.query(tenant, [{
        'a' : 'b',
        'c' : 'e'
      }], { sortProperty: 'id' });

      expect(result.length).to.equal(1);
      expect(result[0]).to.equal(id3);
    });

    it('should return all records if an empty filter array is passed', async () => {
      const items = [ 'b', 'a', 'd', 'c' ];
      for (const item of items) {
        await testIndex.put(tenant, item, item, { letter: item, index: items.indexOf(item) });
      }

      const allResults = await testIndex.query(tenant, [],{ sortProperty: 'letter' });
      expect(allResults).to.eql(['a', 'b', 'c', 'd']);
    });

    it('should not match values prefixed with the query', async () => {
      const id = uuid();
      const doc = {
        id,
        value: 'foobar'
      };

      await testIndex.put(tenant, id, id, doc);

      const resp = await testIndex.query(tenant, [{
        value: 'foo'
      }], { sortProperty: 'id' });

      expect(resp.length).to.equal(0);
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

      await testIndex.put(tenant, id1, id1, doc1);
      await testIndex.put(tenant, id2, id2, doc2);
      await testIndex.put(tenant, id3, id3, doc3);

      const resp = await testIndex.query(tenant, [{
        a: [ 'a', 'b' ]
      }], { sortProperty: 'id' });

      expect(resp.length).to.equal(2);
      expect(resp).to.include(id1);
      expect(resp).to.include(id2);
    });

    it('supports range queries', async () => {
      for (let i = -5; i < 5; ++i) {
        const id = uuid();
        const doc = {
          id,
          dateCreated: Temporal.PlainDateTime.from({ year: 2023, month: 1, day: 15 + i }).toString({ smallestUnit: 'microseconds' })
        };

        await testIndex.put(tenant, id, id, doc);
      }

      const resp = await testIndex.query(tenant, [{
        dateCreated: {
          gte: Temporal.PlainDateTime.from({ year: 2023, month: 1, day: 15 }).toString({ smallestUnit: 'microseconds' })
        }
      }], { sortProperty: 'id' });

      expect(resp.length).to.equal(5);
    });

    it('supports prefixed range queries', async () => {
      const id = uuid();
      const doc = {
        id,
        value: 'foobar'
      };

      await testIndex.put(tenant, id, id, doc);

      const resp = await testIndex.query(tenant, [{
        value: {
          gte: 'foo'
        }
      }], { sortProperty: 'id' });

      expect(resp.length).to.equal(1);
      expect(resp).to.include(id);
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

      await testIndex.put(tenant, id1, id1, doc1);
      await testIndex.put(tenant, id2, id2, doc2);

      const resp = await testIndex.query(tenant, [{
        foo: {
          lte: 'bar'
        }
      }], { sortProperty: 'id' });

      expect(resp.length).to.equal(1);
      expect(resp).to.include(id1);
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

      await testIndex.put(tenant, id1, id1, doc1);
      await testIndex.put(tenant, id2, id2, doc2);

      const resp = await testIndex.query(tenant, [{
        foo: true
      }], { sortProperty: 'id' });

      expect(resp.length).to.equal(1);
      expect(resp).to.include(id1);
    });

    describe('numbers', () => {

      const positiveDigits = Array(10).fill({}).map( _ => TestDataGenerator.randomInt(0, Number.MAX_SAFE_INTEGER)).sort((a,b) => a - b);
      const negativeDigits =
        Array(10).fill({}).map( _ => TestDataGenerator.randomInt(0, Number.MAX_SAFE_INTEGER) * -1).sort((a,b) => a - b);
      const testNumbers = Array.from(new Set([...negativeDigits, ...positiveDigits])); // unique numbers

      it('should return records that match provided number equality filter', async () => {
        const index = Math.floor(Math.random() * testNumbers.length);

        for (const digit of testNumbers) {
          await testIndex.put(tenant, digit.toString(), digit.toString(), { digit });
        }

        const resp = await testIndex.query(tenant, [{
          digit: testNumbers.at(index)!
        }], { sortProperty: 'digit' });

        expect(resp.length).to.equal(1);
        expect(resp.at(0)).to.equal(testNumbers.at(index)!.toString());
      });

      it ('should not return records that do not match provided number equality filter', async() => {
        // remove the potential (but unlikely) negative test result
        for (const digit of testNumbers.filter(n => n !== 1)) {
          await testIndex.put(tenant, digit.toString(), digit.toString(), { digit });
        }
        const resp = await testIndex.query(tenant, [{
          digit: 1
        }], { sortProperty: 'digit' });

        expect(resp.length).to.equal(0);
      });

      it('supports range queries with positive numbers inclusive', async () => {
        for (const digit of testNumbers) {
          await testIndex.put(tenant, digit.toString(), digit.toString(), { digit });
        }

        const upperBound = positiveDigits.at(positiveDigits.length - 3)!;
        const lowerBound = positiveDigits.at(2)!;
        const resp = await testIndex.query(tenant, [{
          digit: {
            gte : lowerBound,
            lte : upperBound
          }
        }], { sortProperty: 'digit' });

        const testResults = testNumbers.filter( n => n >= lowerBound && n <= upperBound).map(n => n.toString());
        expect(resp).to.eql(testResults);
      });

      it('supports range queries with negative numbers inclusive', async () => {
        for (const digit of testNumbers) {
          await testIndex.put(tenant, digit.toString(), digit.toString(), { digit });
        }

        const upperBound = negativeDigits.at(negativeDigits.length - 2)!;
        const lowerBound = negativeDigits.at(2)!;
        const resp = await testIndex.query(tenant, [{
          digit: {
            gte : lowerBound,
            lte : upperBound
          }
        }], { sortProperty: 'digit' });

        const testResults = testNumbers.filter( n => n >= lowerBound && n <= upperBound).map(n => n.toString());
        expect(resp).to.eql(testResults);
      });

      it('should return numbers gt a negative digit', async () => {
        for (const digit of testNumbers) {
          await testIndex.put(tenant, digit.toString(), digit.toString(), { digit });
        }

        const lowerBound = negativeDigits.at(4)!;

        const resp = await testIndex.query(tenant, [{
          digit: {
            gt: lowerBound,
          }
        }], { sortProperty: 'digit' });

        const testResults = testNumbers.filter( n => n > lowerBound).map(n => n.toString());
        expect(resp).to.eql(testResults);
      });

      it('should return numbers gt a digit', async () => {
        for (const digit of testNumbers) {
          await testIndex.put(tenant, digit.toString(), digit.toString(), { digit });
        }

        const lowerBound = positiveDigits.at(4)!;

        const resp = await testIndex.query(tenant, [{
          digit: {
            gt: lowerBound,
          }
        }], { sortProperty: 'digit' });

        const testResults = testNumbers.filter( n => n > lowerBound).map(n => n.toString());
        expect(resp).to.eql(testResults);
      });

      it('should return numbers lt a negative digit', async () => {
        for (const digit of testNumbers) {
          await testIndex.put(tenant, digit.toString(), digit.toString(), { digit });
        }

        const upperBound = negativeDigits.at(4)!;

        const resp = await testIndex.query(tenant, [{
          digit: {
            lt: upperBound,
          }
        }], { sortProperty: 'digit' });

        const testResults = testNumbers.filter( n => n < upperBound).map(n => n.toString());
        expect(resp).to.eql(testResults);
      });

      it('should return numbers lt a digit', async () => {
        for (const digit of testNumbers) {
          await testIndex.put(tenant, digit.toString(), digit.toString(), { digit });
        }

        const upperBound = positiveDigits.at(4)!;

        const resp = await testIndex.query(tenant, [{
          digit: {
            lt: upperBound,
          }
        }], { sortProperty: 'digit' });

        const testResults = testNumbers.filter( n => n < upperBound).map(n => n.toString());
        expect(resp).to.eql(testResults);
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

      await testIndex.put(tenant, id1, id1, doc1);
      await testIndex.put(tenant, id2, id2, doc2);

      let result = await testIndex.query(tenant, [{ 'a': 'b', 'c': 'd' }], { sortProperty: 'id' });

      expect(result.length).to.equal(2);
      expect(result).to.contain(id1);

      await testIndex.delete(tenant, id1);

      result = await testIndex.query(tenant, [{ 'a': 'b', 'c': 'd' }], { sortProperty: 'id' });

      expect(result.length).to.equal(1);

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

      await testIndex.put(tenant, id, id, doc);

      try {
        await testIndex.delete(tenant, id, { signal: controller.signal });
      } catch (e) {
        expect(e).to.equal('reason');
      }

      const result = await testIndex.query(tenant, [{ foo: 'bar' }], { sortProperty: 'id' });
      expect(result.length).to.equal(1);
      expect(result).to.contain(id);
    });

    it('does nothing when attempting to purge key that does not exist', async () => {
      const controller = new AbortController();
      controller.abort('reason');

      const id = uuid();
      const doc = {
        id  : id,
        foo : 'bar'
      };

      await testIndex.put(tenant, id, id, doc);

      // attempt purge an invalid id
      await testIndex.delete(tenant, 'invalid-id');

      const result = await testIndex.query(tenant, [{ foo: 'bar' }], { sortProperty: 'id' });
      expect(result.length).to.equal(1);
      expect(result).to.contain(id);
    });
  });

  describe('sort, limit and cursor', () => {
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

    it('only returns the number of results specified by the limit property', async () => {
      const testVals = [ 'b', 'a', 'd', 'c'];
      for (const val of testVals) {
        await testIndex.put(tenant, val, val, { val, schema: 'schema' });
      }

      // limit results without cursor
      let ascResults = await testIndex.query(tenant, [{ schema: 'schema' }], { sortProperty: 'val', limit: 2 });
      expect(ascResults.length).to.equal(2);
      expect(ascResults).to.eql(['a', 'b']);

      // limit results with a cursor
      ascResults = await testIndex.query(tenant, [{ schema: 'schema' }], { sortProperty: 'val', limit: 2, cursor: 'b' });
      expect(ascResults.length).to.equal(2);
      expect(ascResults).to.eql(['c', 'd']);
    });

    it('invalid sort property returns no results', async () => {
      const testVals = ['b', 'd', 'c', 'a'];
      for (const val of testVals) {
        await testIndex.put(tenant, val, val, { val, schema: 'schema' });
      }

      // control test: return all results
      let validResults = await testIndex.query(tenant, [{ schema: 'schema' }], { sortProperty: 'val' });
      expect(validResults.length).to.equal(4);

      // sort by invalid property returns no results
      let invalidResults = await testIndex.query(tenant, [{ schema: 'schema' }], { sortProperty: 'invalid' });
      expect(invalidResults.length).to.equal(0);

      // control test: returns after cursor
      validResults = await testIndex.query(tenant, [{ schema: 'schema' }], { sortProperty: 'val', cursor: 'a' });
      expect(validResults.length).to.equal(3);

      // invalid sort property with a valid cursor value
      invalidResults = await testIndex.query(tenant, [{ schema: 'schema' }], { sortProperty: 'invalid', cursor: 'a' });
      expect(invalidResults.length).to.equal(0);
    });

    it('invalid cursor returns no results', async () => {
      const testVals = ['b', 'd', 'c', 'a'];
      for (const val of testVals) {
        await testIndex.put(tenant, val, val, { val, schema: 'schema' });
      }

      // verify valid cursor
      const validResults = await testIndex.query(tenant, [{ schema: 'schema' }], { sortProperty: 'val', cursor: 'a' });
      expect(validResults.length).to.equal(3);
      expect(validResults).to.eql(['b', 'c', 'd']);

      // invalid cursor
      const invalidResults = await testIndex.query(tenant, [{ schema: 'schema' }], { sortProperty: 'val', cursor: 'invalid' });
      expect(invalidResults.length).to.equal(0);
    });

    it('can have multiple sort properties', async () => {
      const testVals = ['b', 'd', 'c', 'a'];
      for (const val of testVals) {
        await testIndex.put(tenant, val, val, { val, schema: 'schema', index: testVals.indexOf(val) });
      }

      // sort by value ascending
      const ascResults = await testIndex.query(tenant, [{ schema: 'schema' }], { sortProperty: 'val' });
      expect(ascResults.length).to.equal(testVals.length);
      expect(ascResults).to.eql(['a', 'b', 'c', 'd']);

      // sort by index ascending
      const ascIndexResults = await testIndex.query(tenant, [{ schema: 'schema' }], { sortProperty: 'index' });
      expect(ascIndexResults.length).to.equal(testVals.length);
      expect(ascIndexResults).eql(testVals);

      // sort by value descending
      const descResults = await testIndex.query(tenant, [{ schema: 'schema' }], { sortProperty: 'val', sortDirection: SortDirection.Descending });
      expect(descResults.length).to.equal(testVals.length);
      expect(descResults).to.eql(['d', 'c', 'b', 'a']);

      // sort by index descending
      const descIndexResults = await testIndex.query(tenant, [{ schema: 'schema' }], { sortProperty: 'index', sortDirection: SortDirection.Descending });
      expect(descIndexResults.length).to.equal(testVals.length);
      expect(descIndexResults).eql([...testVals].reverse());
    });

    it('sorts lexicographic with and without a cursor', async () => {
      const testVals = [ 'b', 'a', 'd', 'c'];
      for (const val of testVals) {
        await testIndex.put(tenant, val, val, { val, schema: 'schema' });
      }

      // sort ascending without a cursor
      const ascResults = await testIndex.query(tenant, [{ schema: 'schema' }], { sortProperty: 'val' });
      expect(ascResults.length).to.equal(4);
      expect(ascResults).to.eql(['a', 'b', 'c', 'd']);

      // sort ascending with cursor
      const ascResultsCursor = await testIndex.query(tenant, [{ schema: 'schema' }], { sortProperty: 'val', cursor: 'b' });
      expect(ascResultsCursor.length).to.equal(2);
      expect(ascResultsCursor).to.eql(['c', 'd']);

      // sort descending without a cursor
      const descResults = await testIndex.query(tenant, [{ schema: 'schema' }], { sortProperty: 'val', sortDirection: SortDirection.Descending });
      expect(descResults.length).to.equal(4);
      expect(descResults).to.eql(['d', 'c', 'b', 'a']);

      // sort descending with cursor
      const descResultsCursor = await testIndex.query(tenant, [{ schema: 'schema' }], { sortProperty: 'val', sortDirection: SortDirection.Descending, cursor: 'b' });
      expect(descResultsCursor.length).to.equal(1);
      expect(descResultsCursor).to.eql(['a']);
    });

    it('sorts numeric with and without a cursor', async () => {
      const testVals = [ -2, -1, 0, 1, 2 , 3 , 4 ];
      for (const val of testVals) {
        await testIndex.put(tenant, val.toString(), val.toString(), { val, schema: 'schema' });
      }

      // sort ascending without a cursor
      const ascResults = await testIndex.query(tenant, [{ schema: 'schema' }], { sortProperty: 'val' });
      expect(ascResults.length).to.equal(testVals.length);
      expect(ascResults).to.eql(['-2', '-1', '0', '1', '2' , '3' , '4']);

      // sort ascending with a cursor
      const ascResultsCursor = await testIndex.query(tenant, [{ schema: 'schema' }], { sortProperty: 'val', cursor: '2' });
      expect(ascResultsCursor.length).to.equal(2);
      expect(ascResultsCursor).to.eql(['3', '4']);

      // sort descending without a cursor
      const descResults = await testIndex.query(tenant, [{ schema: 'schema' }], { sortProperty: 'val', sortDirection: SortDirection.Descending });
      expect(descResults.length).to.eql(testVals.length);
      expect(descResults).to.eql(['4', '3', '2', '1', '0' , '-1' , '-2']);

      // sort descending with a cursor
      const descResultsCursor = await testIndex.query(tenant, [{ schema: 'schema' }], { sortProperty: 'val', sortDirection: SortDirection.Descending, cursor: '2' });
      expect(descResultsCursor.length).to.equal(4);
      expect(descResultsCursor).to.eql(['1', '0', '-1', '-2']);
    });

    it('sorts range queries with or without a cursor', async () => {

      const testItems = [ 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h' ];

      for (const item of testItems) {
        await testIndex.put(tenant, item, item, { letter: item });
      }

      // test both upper and lower bounds
      const lowerBound = 'b';
      const upperBound = 'g';

      // ascending without a cursor
      let response = await testIndex.query(tenant, [{
        letter: {
          gte : lowerBound,
          lte : upperBound
        },
      }], { sortProperty: 'letter' });
      expect(response).to.eql(['b', 'c', 'd', 'e', 'f', 'g']);

      // descending without a cursor
      response = await testIndex.query(tenant, [{
        letter: {
          gte : lowerBound,
          lte : upperBound
        },
      }], { sortProperty: 'letter', sortDirection: SortDirection.Descending });
      expect(response).to.eql(['g', 'f', 'e', 'd', 'c', 'b']);

      // ascending with a cursor
      response = await testIndex.query(tenant, [{
        letter: {
          gte : lowerBound,
          lte : upperBound
        },
      }], { sortProperty: 'letter', cursor: 'e' });
      expect(response).to.eql([ 'f', 'g' ]); // should only return greater than e

      // descending with a cursor
      response = await testIndex.query(tenant, [{
        letter: {
          gte : lowerBound,
          lte : upperBound
        },
      }], { sortProperty: 'letter', sortDirection: SortDirection.Descending, cursor: 'e' });
      expect(response).to.eql([ 'd', 'c', 'b' ]); // should only return less than e

      // test only upper bounds
      // ascending without a cursor
      response = await testIndex.query(tenant, [{
        letter: {
          lte: upperBound
        },
      }], { sortProperty: 'letter' });
      expect(response).to.eql(['a', 'b', 'c', 'd', 'e', 'f', 'g']);

      // descending without a cursor
      response = await testIndex.query(tenant, [{
        letter: {
          lte: upperBound
        },
      }], { sortProperty: 'letter', sortDirection: SortDirection.Descending });
      expect(response).to.eql(['g', 'f', 'e', 'd', 'c', 'b', 'a']);

      // ascending with a cursor
      response = await testIndex.query(tenant, [{
        letter: {
          lte: upperBound
        },
      }], { sortProperty: 'letter', cursor: 'e' });
      expect(response).to.eql([ 'f', 'g' ]); // should only return items greater than e

      // descending with a cursor
      response = await testIndex.query(tenant, [{
        letter: {
          lte: upperBound
        },
      }], { sortProperty: 'letter', sortDirection: SortDirection.Descending, cursor: 'e' });
      expect(response).to.eql([ 'd', 'c', 'b', 'a' ]); // should only return items less than e
    });

    it('sorts range queries negative integers with or without a cursor', async () => {
      const testNumbers = [ -5, -4, -3 , -2, -1, 0, 1, 2, 3, 4, 5 ];
      for (const digit of testNumbers) {
        await testIndex.put(tenant, digit.toString(), digit.toString(), { digit });
      }

      const upperBound = 3;
      const lowerBound = -2;
      let results = await testIndex.query(tenant, [{
        digit: {
          gte : lowerBound,
          lte : upperBound
        }
      }], { sortProperty: 'digit' });
      expect(results).to.eql([ '-2', '-1', '0', '1', '2', '3' ]);

      results = await testIndex.query(tenant, [{
        digit: {
          gte : lowerBound,
          lte : upperBound
        }
      }], { sortProperty: 'digit', cursor: '-2' });
      expect(results).to.eql(['-1', '0', '1', '2', '3']);
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
        await testIndex.put(tenant, item.id, item.id, item);
      }

      const lowerBound = 2;
      const upperBound = 4;

      // with both lower and upper bounds
      // ascending with a cursor
      // this cursor should ony return results from the 'lte' part of the filter
      let response = await testIndex.query(tenant, [{
        digit: {
          gte : lowerBound,
          lte : upperBound
        },
      }], { sortProperty: 'id', cursor: 'd' });

      expect(response).to.eql([ 'e', 'f', 'g' ]);

      // with no lower bounds
      // ascending with a cursor
      // this cursor should ony return results from the 'lte' part of the filter
      response = await testIndex.query(tenant, [{
        digit: {
          lte: upperBound
        },
      }], { sortProperty: 'id', cursor: 'd' });

      expect(response).to.eql([ 'e', 'f', 'g']); // should only return two matching items
    });

    it('sorts OR queries with or without a cursor', async () => {
      const testValsSchema1 = ['a1', 'b1', 'c1', 'd1'];
      for (const val of testValsSchema1) {
        await testIndex.put(tenant, val, val, { val, schema: 'schema1' });
      }

      const testValsSchema2 = ['a2', 'b2', 'c2', 'd2'];
      for (const val of testValsSchema2) {
        await testIndex.put(tenant, val, val, { val, schema: 'schema2' });
      }

      // sort ascending without cursor
      let results = await testIndex.query(tenant, [{
        schema: ['schema1', 'schema2']
      }], { sortProperty: 'val' });
      expect(results).to.eql(['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'd1', 'd2']);

      // sort ascending from b2 onwards
      results = await testIndex.query(tenant, [{
        schema: ['schema1', 'schema2']
      }], { sortProperty: 'val', cursor: 'b2' });
      expect(results).to.eql(['c1', 'c2', 'd1', 'd2']);
    });

    it('supports multiple filtered queries', async () => {
      const items:Array<{ val: string, digit: number, property?: boolean }> = [];

      // create 30 records with random digits between 1-9
      // every 3rd record should be a negative number
      // every 5th record a property should be set to true
      // every 7th record a property should bes set to false
      for (let i = 0; i < 30; i++) {
        const digit = i % 3 === 0 ?
          TestDataGenerator.randomInt(1,9) * -1:
          TestDataGenerator.randomInt(1,9);

        const property = i % 5 === 0 ? true :
          i % 7 === 0 ? false : undefined;

        const item = { val: IndexLevel.encodeNumberValue(i), digit, property };
        await testIndex.put(tenant, item.val, item.val, item);
        items.push(item);
      }

      const lowerBounds = -2;
      const upperBounds = 3;

      // create the expected results;
      const compareResults = new Set([
        ...items.filter(i => i.digit >= lowerBounds && i.digit <= upperBounds),
        ...items.filter(i => i.property === true),
      ].sort((a,b) => lexicographicalCompare(a.val, b.val)).map(i => i.val));

      // query in ascending order.
      const results = await testIndex.query(tenant,
        [
          { digit: { gte: lowerBounds, lte: upperBounds } },
          { property: true }
        ], { sortProperty: 'val' });
      console.log('results 1');
      expect(results).to.eql([...compareResults], 'results ascending');

      const compareResultsAfterCursor = new Set([
        ...items.slice(5).filter(i => i.digit >= lowerBounds && i.digit <= upperBounds),
        ...items.slice(5).filter(i => i.property === true),
      ].sort((a,b) => lexicographicalCompare(a.val, b.val))
        .map(i => i.val));

      // query in ascending order with cursor.
      const resultsWithCursor = await testIndex.query(tenant, [
        { digit: { gte: lowerBounds, lte: upperBounds } },
        { property: true },
      ], { sortProperty: 'val', cursor: IndexLevel.encodeNumberValue(4) });

      console.log('results 2');
      expect(resultsWithCursor).to.eql([...compareResultsAfterCursor], 'results after cursor ascending');

      const descResults = await testIndex.query(tenant,
        [
          { digit: { gte: lowerBounds, lte: upperBounds } },
          { property: true }
        ], { sortProperty: 'val', sortDirection: SortDirection.Descending });

      console.log('results 3');
      expect(descResults).to.eql([...compareResults].reverse(), 'results descending');

      const descResultsAfterCursor = await testIndex.query(tenant,
        [
          { digit: { gte: lowerBounds, lte: upperBounds } },
          { property: true }
        ], { sortProperty: 'val', sortDirection: SortDirection.Descending, cursor: IndexLevel.encodeNumberValue(4) });

      const compareResultsAfterCursorDesc = new Set([
        ...items.slice(0, 4).filter(i => i.digit >= lowerBounds && i.digit <= upperBounds),
        ...items.slice(0, 4).filter(i => i.property === true),
      ].sort((a,b) => lexicographicalCompare(b.val, a.val))
        .map(i => i.val));

      console.log('results 4');
      expect(descResultsAfterCursor).to.eql([...compareResultsAfterCursorDesc], 'results after cursor descending');
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