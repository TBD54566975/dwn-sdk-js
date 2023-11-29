import type { Filter } from '../../src/types/query-types.js';

import { IndexLevel } from '../../src/store/index-level.js';
import { lexicographicalCompare } from '../../src/utils/string.js';
import { Time } from '../../src/utils/time.js';
import { FilterSelector, FilterUtility } from '../../src/utils/filter.js';

import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';


chai.use(chaiAsPromised);

describe('filters util', () => {
  describe('FilterUtility', () => {
    describe ('filter type', () => {
      const filter: Filter = {
        equal    : 'to',
        oneOf    : [ 'these', 'items' ],
        range    : { gte: 10, lte: 20 },
        rangeGT  : { gt: 10 },
        rangeGTE : { gte: 10 },
        rangeLT  : { lt: 20 },
        rangeLTE : { lte: 20 },
      };

      it('isEqualFilter', async () => {
        const { equal, oneOf, range } = filter;
        expect(FilterUtility.isEqualFilter(equal)).to.be.true;
        expect(FilterUtility.isEqualFilter(oneOf)).to.be.false;
        expect(FilterUtility.isEqualFilter(range)).to.be.false;
      });;

      it('isRangeFilter', async () => {
        const { equal, oneOf, range, rangeGT, rangeGTE, rangeLT, rangeLTE } = filter;
        expect(FilterUtility.isRangeFilter(range)).to.be.true;
        expect(FilterUtility.isRangeFilter(rangeGT)).to.be.true;
        expect(FilterUtility.isRangeFilter(rangeGTE)).to.be.true;
        expect(FilterUtility.isRangeFilter(rangeLT)).to.be.true;
        expect(FilterUtility.isRangeFilter(rangeLTE)).to.be.true;
        expect(FilterUtility.isRangeFilter(oneOf)).to.be.false;
        expect(FilterUtility.isRangeFilter(equal)).to.be.false;
      });

      it('isOneOfFilter', async () => {
        const { equal, oneOf, range } = filter;
        expect(FilterUtility.isOneOfFilter(oneOf)).to.be.true;
        expect(FilterUtility.isOneOfFilter(equal)).to.be.false;
        expect(FilterUtility.isOneOfFilter(range)).to.be.false;
      });
    });

    describe('matchFilter', () => {
      it('should match with EqualFilter', async () => {
        const filters = [{ foo: 'bar' }];
        expect(FilterUtility.matchAnyFilter({ foo: 'bar' }, filters)).to.be.true;
        expect(FilterUtility.matchAnyFilter({ foo: 'bar', bar: 'baz' }, filters)).to.be.true;
        expect(FilterUtility.matchAnyFilter({ bar: 'baz' }, filters)).to.be.false;
      });

      it('should not match partial values with an EqualFilter', async () => {
        const filters = [{ foo: 'bar' }];
        expect(FilterUtility.matchAnyFilter({ foo: 'barbaz' }, filters)).to.be.false;
      });

      it('should match with OneOfFilter', async () => {
        const filters = [{
          a: [ 'a', 'b' ]
        }];

        expect(FilterUtility.matchAnyFilter({ 'a': 'a' }, filters)).to.be.true;
        expect(FilterUtility.matchAnyFilter({ 'a': 'b' }, filters)).to.be.true;
        expect(FilterUtility.matchAnyFilter({ 'a': 'c' }, filters)).to.be.false;
      });

      it('should match string within a RangeFilter', async () => {
        const gteFilter = [{
          dateCreated: {
            gte: Time.createTimestamp({ year: 2023, month: 1, day: 15 })
          }
        }];

        // test the equal to the desired range.
        expect(FilterUtility.matchAnyFilter({
          dateCreated: Time.createTimestamp({ year: 2023, month: 1, day: 15 })
        }, gteFilter)).to.be.true;

        // test greater than the desired range.
        expect(FilterUtility.matchAnyFilter({
          dateCreated: Time.createTimestamp({ year: 2023, month: 1, day: 16 })
        }, gteFilter)).to.be.true;

        // test less than desired range.
        expect(FilterUtility.matchAnyFilter({
          dateCreated: Time.createTimestamp({ year: 2023, month: 1, day: 10 })
        }, gteFilter)).to.be.false;

        const gtFilter = [{
          dateCreated: {
            gt: Time.createTimestamp({ year: 2023, month: 1, day: 15 })
          }
        }];
        // test the equal to
        expect(FilterUtility.matchAnyFilter({
          dateCreated: Time.createTimestamp({ year: 2023, month: 1, day: 15 })
        }, gtFilter)).to.be.false;

        // test greater than.
        expect(FilterUtility.matchAnyFilter({
          dateCreated: Time.createTimestamp({ year: 2023, month: 1, day: 16 })
        }, gtFilter)).to.be.true;

        const lteFilter = [{
          dateCreated: {
            lte: Time.createTimestamp({ year: 2023, month: 1, day: 15 })
          }
        }];

        // test the equal to the desired range.
        expect(FilterUtility.matchAnyFilter({
          dateCreated: Time.createTimestamp({ year: 2023, month: 1, day: 15 })
        }, lteFilter)).to.be.true;

        // test less than desired range.
        expect(FilterUtility.matchAnyFilter({
          dateCreated: Time.createTimestamp({ year: 2023, month: 1, day: 13 })
        }, lteFilter)).to.be.true;

        // test greater than desired range.
        expect(FilterUtility.matchAnyFilter({
          dateCreated: Time.createTimestamp({ year: 2023, month: 1, day: 16 })
        }, lteFilter)).to.be.false;

        const ltFilter = [{
          dateCreated: {
            lt: Time.createTimestamp({ year: 2023, month: 1, day: 15 })
          }
        }];

        // checks less than
        expect(FilterUtility.matchAnyFilter({
          dateCreated: Time.createTimestamp({ year: 2023, month: 1, day: 14 })
        }, ltFilter)).to.be.true;

        // checks equal to
        expect(FilterUtility.matchAnyFilter({
          dateCreated: Time.createTimestamp({ year: 2023, month: 1, day: 15 })
        }, ltFilter)).to.be.false;
      });

      it('should match prefixed RangeFilter', async () => {
        const filters = [{
          value: {
            gte: 'foo'
          }
        }];

        expect(FilterUtility.matchAnyFilter({ value: 'foobar' }, filters)).to.be.true;
      });

      it('should match suffixed RangeFilter', async () => {
        const filters = [{
          foo: {
            lte: 'bar'
          }
        }];

        expect(FilterUtility.matchAnyFilter({ foo: 'bar' }, filters)).to.be.true;
        expect(FilterUtility.matchAnyFilter({ foo: 'barbaz' }, filters)).to.be.false;
      });

      it('should match multiple properties', async () => {
        const filters = [{
          foo : 'bar',
          bar : 'baz'
        }];
        expect(FilterUtility.matchAnyFilter({ foo: 'bar', bar: 'baz' }, filters)).to.be.true;
        expect(FilterUtility.matchAnyFilter({ foo: 'baz', bar: 'baz' }, filters)).to.be.false;
      });

      it('should match with multiple filters', async () => {
        const filters:Filter[] = [{
          foo : 'bar',
          bar : 'baz'
        },{
          foobar: 'baz'
        }];

        // match first filter
        expect(FilterUtility.matchAnyFilter({ foo: 'bar', bar: 'baz' }, filters)).to.be.true;
        // match second filter
        expect(FilterUtility.matchAnyFilter({ foobar: 'baz', foo: 'bar' }, filters)).to.be.true;
        // control no match
        expect(FilterUtility.matchAnyFilter({ foo: 'bar' }, filters)).to.be.false;
      });

      it('should match anything if an empty array or empty filters are provided', async () => {
        expect(FilterUtility.matchAnyFilter({ foo: 'bar', bar: 'baz' }, [])).to.be.true;
        expect(FilterUtility.matchAnyFilter({ foobar: 'baz', foo: 'bar' }, [{}])).to.be.true;
      });

      describe('booleans', () => {
        it('treats strings and boolean EqualFilter differently', async () => {

          const filters = [{
            foo: true
          }];

          expect(FilterUtility.matchAnyFilter({ foo: true }, filters)).to.be.true;
          expect(FilterUtility.matchAnyFilter({ foo: 'true' }, filters)).to.be.false;
        });

        it('should return records that match provided boolean equality filter', async () => {
          const boolTrueItem = {
            schema    : 'schema',
            published : true,
          };

          const boolFalseItem = {
            schema    : 'schema',
            published : false,
          };

          // control
          expect(FilterUtility.matchAnyFilter(boolTrueItem, [{ published: true }])).to.be.true;
          expect(FilterUtility.matchAnyFilter(boolTrueItem, [{ published: false }])).to.be.false;
          expect(FilterUtility.matchAnyFilter(boolFalseItem, [{ published: false }])).to.be.true;
          expect(FilterUtility.matchAnyFilter(boolFalseItem, [{ published: true }])).to.be.false;
        });
      });

      describe('numbers', () => {
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
  });
});