import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { ArrayUtility } from '../../src/utils/array.js';
import { IndexLevel } from '../../src/store/index-level.js';
import { lexicographicalCompare } from '../../src/utils/string.js';
import { Temporal } from '@js-temporal/polyfill';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { v4 as uuid } from 'uuid';

chai.use(chaiAsPromised);

let index: IndexLevel;

describe('Index Level', () => {
  describe('put', () => {
    before(async () => {
      index = new IndexLevel({ location: 'TEST-INDEX' });
      await index.open();
    });

    beforeEach(async () => {
      await index.clear();
    });

    after(async () => {
      await index.close();
    });

    it('adds 1 key per property aside from id', async () => {
      await index.put(uuid(), {
        dateCreated : new Date().toISOString(),
        'a'         : 'b',
        'c'         : 'd'
      });

      const keys = await ArrayUtility.fromAsyncGenerator(index.db.keys());
      expect(keys.length).to.equal(4);
    });

    it('flattens nested records', async () => {
      const id = uuid();
      const doc = {
        some: {
          nested: {
            object: true
          }
        }
      };
      await index.put(id, doc);

      const key = await index.db.get(index['join']('some.nested.object', true, id));
      expect(key).to.equal(id);
    });

    it('removes empty objects', async () => {
      const id = uuid();
      const doc = {
        empty: { nested: { } }
      };
      await index.put(id, doc);

      await expect(index.db.get(index['join']('empty', '[object Object]', id))).to.eventually.be.undefined;
      await expect(index.db.get(index['join']('empty.nested', '[object Object]', id))).to.eventually.be.undefined;
    });

    it('removes empty arrays', async () => {
      const id = uuid();
      const doc = {
        empty: [ [ ] ]
      };
      await index.put(id, doc);

      await expect(index.db.get(index['join']('empty', '', id))).to.eventually.be.undefined;
      await expect(index.db.get(index['join']('empty.0', '', id))).to.eventually.be.undefined;
    });

    it('should not put anything if aborted beforehand', async () => {
      const controller = new AbortController();
      controller.abort('reason');

      const id = uuid();
      const doc = {
        foo: 'bar'
      };

      try {
        await index.put(id, doc, { signal: controller.signal });
      } catch (e) {
        expect(e).to.equal('reason');
      }

      const result = await index.query([{ foo: 'bar' }]);
      expect(result.length).to.equal(0);
    });

    it('should extract value from key', async () => {
      const testValue = 'testValue';
      await index.put(uuid(), {
        dateCreated : new Date().toISOString(),
        'testKey'   : testValue,
      });

      const keys = await ArrayUtility.fromAsyncGenerator(index.db.keys());
      // encoded string values are surrounded by quotes.
      expect(keys.filter( k => IndexLevel.extractValueFromKey(k) === `"${testValue}"`).length).to.equal(1);
    });
  });

  describe('query', () => {
    before(async () => {
      index = new IndexLevel({ location: 'TEST-INDEX' });
      await index.open();
    });

    beforeEach(async () => {
      await index.clear();
    });

    after(async () => {
      await index.close();
    });

    it('works', async () => {
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

      await index.put(id1, doc1);
      await index.put(id2, doc2);
      await index.put(id3, doc3);

      const result = await index.query([{
        'a' : 'b',
        'c' : 'e'
      }]);

      expect(result.length).to.equal(1);
      expect(result[0]).to.equal(id3);
    });

    it('should not match values prefixed with the query', async () => {
      const id = uuid();
      const doc = {
        value: 'foobar'
      };

      await index.put(id, doc);

      const resp = await index.query([{
        value: 'foo'
      }]);

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

      await index.put(id1, doc1);
      await index.put(id2, doc2);
      await index.put(id3, doc3);

      const resp = await index.query([{
        a: [ 'a', 'b' ]
      }]);

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

        await index.put(id, doc);
      }

      const resp = await index.query([{
        dateCreated: {
          gte: Temporal.PlainDateTime.from({ year: 2023, month: 1, day: 15 }).toString({ smallestUnit: 'microseconds' })
        }
      }]);

      expect(resp.length).to.equal(5);
    });

    it('supports prefixed range queries', async () => {
      const id = uuid();
      const doc = {
        value: 'foobar'
      };

      await index.put(id, doc);

      const resp = await index.query([{
        value: {
          gte: 'foo'
        }
      }]);

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

      await index.put(id1, doc1);
      await index.put(id2, doc2);

      const resp = await index.query([{
        foo: {
          lte: 'bar'
        }
      }]);

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

      await index.put(id1, doc1);
      await index.put(id2, doc2);

      const resp = await index.query([{
        foo: true
      }]);

      expect(resp.length).to.equal(1);
      expect(resp).to.include(id1);
    });

    describe('numbers', () => {

      const positiveDigits = Array(10).fill({}).map( _ => TestDataGenerator.randomInt(0, Number.MAX_SAFE_INTEGER)).sort((a,b) => a - b);
      const negativeDigits =
        Array(10).fill({}).map( _ => TestDataGenerator.randomInt(0, Number.MAX_SAFE_INTEGER) * -1).sort((a,b) => a - b);
      const testNumbers = Array.from(new Set([...positiveDigits, ...negativeDigits])); // unique numbers

      it('should return records that match provided number equality filter', async () => {
        const testIndex = Math.floor(Math.random() * testNumbers.length);

        for (const digit of testNumbers) {
          await index.put(digit.toString(), { digit });
        }
        const resp = await index.query([{
          digit: testNumbers.at(testIndex)!
        }]);

        expect(resp.length).to.equal(1);
        expect(resp.at(0)).to.equal(testNumbers.at(testIndex)!.toString());
      });

      it ('should not return records that do not match provided number equality filter', async() => {
        // remove the potential (but unlikely) negative test result
        for (const digit of testNumbers.filter(n => n !== 1)) {
          await index.put(digit.toString(), { digit });
        }
        const resp = await index.query([{
          digit: 1
        }]);

        expect(resp.length).to.equal(0);
      });

      it('supports range queries with positive numbers inclusive', async () => {
        for (const digit of testNumbers) {
          await index.put(digit.toString(), { digit });
        }

        const upperBound = positiveDigits.at(positiveDigits.length - 3)!;
        const lowerBound = positiveDigits.at(2)!;
        const resp = await index.query([{
          digit: {
            gte : lowerBound,
            lte : upperBound
          }
        }]);

        const testResults = testNumbers.filter( n => n >= lowerBound && n <= upperBound).map(n => n.toString());
        expect(resp.sort()).to.eql(testResults.sort());
      });

      it('supports range queries with negative numbers inclusive', async () => {
        for (const digit of testNumbers) {
          await index.put(digit.toString(), { digit });
        }

        const upperBound = negativeDigits.at(negativeDigits.length - 2)!;
        const lowerBound = negativeDigits.at(2)!;
        const resp = await index.query([{
          digit: {
            gte : lowerBound,
            lte : upperBound
          }
        }]);

        const testResults = testNumbers.filter( n => n >= lowerBound && n <= upperBound).map(n => n.toString());
        expect(resp.sort()).to.eql(testResults.sort());
      });

      it('should return numbers gt a negative digit', async () => {
        for (const digit of testNumbers) {
          await index.put(digit.toString(), { digit });
        }

        const lowerBound = negativeDigits.at(4)!;

        const resp = await index.query([{
          digit: {
            gt: lowerBound,
          }
        }]);

        const testResults = testNumbers.filter( n => n > lowerBound).map(n => n.toString());
        expect(resp.sort()).to.eql(testResults.sort());
      });

      it('should return numbers gt a digit', async () => {
        for (const digit of testNumbers) {
          await index.put(digit.toString(), { digit });
        }

        const lowerBound = positiveDigits.at(4)!;

        const resp = await index.query([{
          digit: {
            gt: lowerBound,
          }
        }]);

        const testResults = testNumbers.filter( n => n > lowerBound).map(n => n.toString());
        expect(resp.sort()).to.eql(testResults.sort());
      });

      it('should return numbers lt a negative digit', async () => {
        for (const digit of testNumbers) {
          await index.put(digit.toString(), { digit });
        }

        const upperBound = negativeDigits.at(4)!;

        const resp = await index.query([{
          digit: {
            lt: upperBound,
          }
        }]);

        const testResults = testNumbers.filter( n => n < upperBound).map(n => n.toString());
        expect(resp.sort()).to.eql(testResults.sort());
      });

      it('should return numbers lt a digit', async () => {
        for (const digit of testNumbers) {
          await index.put(digit.toString(), { digit });
        }

        const upperBound = positiveDigits.at(4)!;

        const resp = await index.query([{
          digit: {
            lt: upperBound,
          }
        }]);

        const testResults = testNumbers.filter( n => n < upperBound).map(n => n.toString());
        expect(resp.sort()).to.eql(testResults.sort());
      });
    });
  });

  describe('delete', () => {
    before(async () => {
      index = new IndexLevel({ location: 'TEST-INDEX' });
      await index.open();
    });

    beforeEach(async () => {
      await index.clear();
    });

    after(async () => {
      await index.close();
    });

    it('works', async () => {
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

      await index.put(id1, doc1);
      await index.put(id2, doc2);

      let result = await index.query([{ 'a': 'b', 'c': 'd' }]);

      expect(result.length).to.equal(2);
      expect(result).to.contain(id1);

      await index.delete(id1);


      result = await index.query([{ 'a': 'b', 'c': 'd' }]);

      expect(result.length).to.equal(1);
    });

    it('should not delete anything if aborted beforehand', async () => {
      const controller = new AbortController();
      controller.abort('reason');

      const id = uuid();
      const doc = {
        foo: 'bar'
      };

      await index.put(id, doc);

      try {
        await index.delete(id, { signal: controller.signal });
      } catch (e) {
        expect(e).to.equal('reason');
      }

      const result = await index.query([{ foo: 'bar' }]);
      expect(result.length).to.equal(1);
      expect(result).to.contain(id);
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