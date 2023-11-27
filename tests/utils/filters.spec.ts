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

  describe('FilterSelector', () => {
    describe('reduce()', () => {
      it('should return a single rangeFilter per input filter if a range filter exists in all of the filters', async () => {
        // scenario: there are two filters that both have range filters
        // it should return two filters that each only has the range filter.
        const inputFilters:Filter[] = [{
          protocol         : 'some-protocol',
          schema           : 'some-schema',
          messageTimestamp : { gte: '2023-11-20T00:00:00.000000Z' },
        },{
          protocol    : 'some-protocol2',
          schema      : 'some-schema2',
          dateCreated : { gte: '2023-11-20T00:00:00.000000Z' },
        }];

        const filters = FilterSelector.reduceFilters(inputFilters);
        expect(filters.length).to.equal(2);
        const returnFilters = filters.map(filter => Object.values(filter));
        //expect each filter to only have a single filter value and for it to be a range filter
        expect(returnFilters.every(filter => filter.length === 1 && FilterUtility.isRangeFilter(filter[0]))).to.be.true;
      });

      describe('common filters', () => {
        describe('should combine common filters into a single filter', () => {
          it('contextId', async () => {
            const inputFilters:Filter[] = [{
              protocol  : 'some-protocol-1',
              schema    : 'some-schema-1',
              contextId : 'some-context-id' // common
            },{
              protocol  : 'some-protocol-2',
              schema    : 'some-schema-2',
              contextId : 'some-context-id' // common
            }];

            const filters = FilterSelector.reduceFilters(inputFilters);
            expect(filters.length).to.equal(1);
            expect(filters[0].contextId).to.not.be.undefined;
            expect(Object.keys(filters[0]).length).to.equal(1);
            expect(filters[0].contextId).to.equal('some-context-id');
          });

          it('schema', async () => {
            const inputFilters = [{
              protocol : 'some-protocol-1',
              schema   : 'some-schema', //common
            },{
              protocol : 'some-protocol-2',
              schema   : 'some-schema', //common
            }];

            const filters = FilterSelector.reduceFilters(inputFilters);
            expect(filters.length).to.equal(1);
            expect(filters[0].schema).to.not.be.undefined;
            expect(Object.keys(filters[0]).length).to.equal(1);
            expect(filters[0].schema).to.equal('some-schema');
          });

          it('protocolPath', async () => {
            const inputFilters = [{
              protocol     : 'some-protocol',
              protocolPath : 'some-protocol-path', //common
              schema       : 'some-schema-1',
            },{
              protocol     : 'some-protocol',
              protocolPath : 'some-protocol-path', //common
              schema       : 'some-schema-2',
            }];

            const filters = FilterSelector.reduceFilters(inputFilters);
            expect(filters.length).to.equal(1);
            expect(filters[0].protocolPath).to.not.be.undefined;
            expect(Object.keys(filters[0]).length).to.equal(1);
            expect(filters[0].protocolPath).to.equal('some-protocol-path');
          });

          it('protocol', async () => {
            const inputFilters = [{
              protocol : 'some-protocol', // common
              schema   : 'some-schema-1',
            },{
              protocol : 'some-protocol', // common
              schema   : 'some-schema-2',
            }];

            const filters = FilterSelector.reduceFilters(inputFilters);
            expect(filters.length).to.equal(1);
            expect(filters[0].protocol).to.not.be.undefined;
            expect(Object.keys(filters[0]).length).to.equal(1);
            expect(filters[0].protocol).to.equal('some-protocol');
          });
        });

        it('should not combine common filters that are not contextId, schema, protocolPath or protocol', async () => {
          const inputFilters = [{
            someFilter : 'some-filter', //common
            protocol   : 'some-protocol-1',
            schema     : 'some-schema-1',
          },{
            someFilter : 'some-filter', //common
            protocol   : 'some-protocol-2',
            schema     : 'some-schema-2',
          }];

          const filters = FilterSelector.reduceFilters(inputFilters);
          expect(filters.length).to.equal(2);
        });

        it('should give priority to common contextId', async () => {
          // scenario: all 4 fields are common, but the return filter will only have contextId
          const inputFilters:Filter[] = [{
            protocol     : 'some-protocol',
            schema       : 'some-schema',
            protocolPath : 'some-protocol-path',
            contextId    : 'some-context-id'
          },{
            protocol     : 'some-protocol',
            schema       : 'some-schema',
            protocolPath : 'some-protocol-path',
            contextId    : 'some-context-id'
          }];

          const filters = FilterSelector.reduceFilters(inputFilters);
          expect(filters.length).to.equal(1);
          expect(filters[0].contextId).to.not.be.undefined;
          expect(Object.keys(filters[0]).length).to.equal(1);
          expect(filters[0].contextId).to.equal('some-context-id');
        });

        it('should give priority to common schema over protocolPath and protocol', async () => {
          // scenario: all 3 fields are common, but the return filter will only have schema
          const inputFilters:Filter[] = [{
            protocol     : 'some-protocol',
            schema       : 'some-schema',
            protocolPath : 'some-protocol-path',
          },{
            protocol     : 'some-protocol',
            schema       : 'some-schema',
            protocolPath : 'some-protocol-path',
          }];

          const filters = FilterSelector.reduceFilters(inputFilters);
          expect(filters.length).to.equal(1);
          expect(filters[0].schema).to.not.be.undefined;
          expect(Object.keys(filters[0]).length).to.equal(1);
          expect(filters[0].schema).to.equal('some-schema');
        });

        it('should give priority to common protocolPath over protocol', async () => {
          // scenario: 2 fields are common, but the return filter will only have protocolPath
          const inputFilters:Filter[] = [{
            protocol     : 'some-protocol',
            protocolPath : 'some-protocol-path',
          },{
            protocol     : 'some-protocol',
            protocolPath : 'some-protocol-path',
          }];

          const filters = FilterSelector.reduceFilters(inputFilters);
          expect(filters.length).to.equal(1);
          expect(filters[0].protocolPath).to.not.be.undefined;
          expect(Object.keys(filters[0]).length).to.equal(1);
          expect(filters[0].protocolPath).to.equal('some-protocol-path');
        });
      });

      describe('range filters', () => {
        it('should return range filters', async () => {
          const inputFilters:Filter[] = [
            { schema: 'some-schema-1', messageTimestamp: { gt: 'gt-some-message-timestamp' } },
            { schema: 'some-schema-2', messageTimestamp: { gte: 'gte-some-message-timestamp' } },
            { schema: 'some-schema-3', messageTimestamp: { lt: 'lt-some-message-timestamp' } },
            { schema: 'some-schema-4', messageTimestamp: { lte: 'lte-some-message-timestamp' } },
          ];

          const filters = FilterSelector.reduceFilters(inputFilters);
          expect(filters.length).to.equal(4);
          expect(filters[0].messageTimestamp).to.not.be.undefined;
          expect(Object.keys(filters[0]).length).to.equal(1);
          expect(filters[0].messageTimestamp).to.deep.equal({ gt: 'gt-some-message-timestamp' });
          expect(filters[1].messageTimestamp).to.not.be.undefined;
          expect(Object.keys(filters[1]).length).to.equal(1);
          expect(filters[1].messageTimestamp).to.deep.equal({ gte: 'gte-some-message-timestamp' });
          expect(filters[2].messageTimestamp).to.not.be.undefined;
          expect(Object.keys(filters[2]).length).to.equal(1);
          expect(filters[2].messageTimestamp).to.deep.equal({ lt: 'lt-some-message-timestamp' });
          expect(filters[3].messageTimestamp).to.not.be.undefined;
          expect(Object.keys(filters[3]).length).to.equal(1);
          expect(filters[3].messageTimestamp).to.deep.equal({ lte: 'lte-some-message-timestamp' });
        });

        it('should only return range filters without recordIds ', async () => {
          const inputFilters:Filter[] = [
            { recordId: 'some-record-id', schema: 'some-schema-1', messageTimestamp: { gt: 'gt-some-message-timestamp' } },
            { recordId: 'some-record-id-2', schema: 'some-schema-2', messageTimestamp: { gte: 'gte-some-message-timestamp' } },
            { schema: 'some-schema-3', messageTimestamp: { lt: 'lt-some-message-timestamp' } },
            { schema: 'some-schema-4', messageTimestamp: { lte: 'lte-some-message-timestamp' } },
          ];

          const filters = FilterSelector.reduceFilters(inputFilters);
          expect(filters.length).to.equal(4);
          expect(filters[0].messageTimestamp).to.be.undefined;
          expect(filters[1].messageTimestamp).to.be.undefined;
          expect(filters[2].messageTimestamp).to.not.be.undefined;
          expect(Object.keys(filters[2]).length).to.equal(1);
          expect(filters[2].messageTimestamp).to.deep.equal({ lt: 'lt-some-message-timestamp' });
          expect(filters[3].messageTimestamp).to.not.be.undefined;
          expect(Object.keys(filters[3]).length).to.equal(1);
          expect(filters[3].messageTimestamp).to.deep.equal({ lte: 'lte-some-message-timestamp' });
        });

        it('should return combined common filter after range has been reduced', async () => {
          const inputFilters:Filter[] = [
            { schema: 'some-schema-1', messageTimestamp: { gt: 'gt-some-message-timestamp' } },
            { schema: 'some-schema-2', messageTimestamp: { gte: 'gte-some-message-timestamp' } },
            { schema: 'some-schema-3' },
            { schema: 'some-schema-3' },
          ];

          const filters = FilterSelector.reduceFilters(inputFilters);
          expect(filters.length).to.equal(3);
          expect(filters[0].messageTimestamp).to.not.be.undefined;
          expect(Object.keys(filters[0]).length).to.equal(1);
          expect(filters[0].messageTimestamp).to.deep.equal({ gt: 'gt-some-message-timestamp' });
          expect(filters[1].messageTimestamp).to.not.be.undefined;
          expect(Object.keys(filters[1]).length).to.equal(1);
          expect(filters[1].messageTimestamp).to.deep.equal({ gte: 'gte-some-message-timestamp' });
          expect(filters[2].messageTimestamp).to.be.undefined; // the last filter does not have messageTimestamp as a filter
        });
      });

      describe('id filters', () => {
        it('should always return filters that filter for recordId', async () => {
          // scenario 1: one of the filters looks for a specific recordId
          //             the returned filters must include a filter for the recordId.
          //             it can only have one filter property
          let inputFilters:Filter[] = [{
            protocol : 'some-protocol',
            schema   : 'some-schema',
          },{
            protocol : 'some-protocol2',
            schema   : 'some-schema2',
            recordId : 'some-record-id'
          }];

          let filters = FilterSelector.reduceFilters(inputFilters);
          expect(filters.length).to.equal(2);
          const recordIdFilter = filters.find(filter => filter.recordId !== undefined);
          expect(recordIdFilter).to.not.be.undefined;
          expect(Object.keys(recordIdFilter!).length).to.equal(1);
          expect(recordIdFilter!.recordId).to.equal('some-record-id');

          // scenario 2: both of the filters look for recordIds,
          //             both of the returned filters must include a filter for the respective recordId.
          //             it can only have one filter property

          inputFilters = [{
            protocol : 'some-protocol',
            schema   : 'some-schema',
            recordId : 'some-record-id-1'
          },{
            protocol : 'some-protocol2',
            schema   : 'some-schema2',
            recordId : 'some-record-id-2'
          }];

          filters = FilterSelector.reduceFilters(inputFilters);
          expect(filters.length).to.equal(2);
          expect(filters.every(filter => filter.recordId !== undefined && Object.keys(filter).length === 1)).to.be.true;
          expect(inputFilters[0].recordId).to.equal(filters[0].recordId);
          expect(inputFilters[1].recordId).to.equal(filters[1].recordId);

          // scenario 3: a filter containing an array of recordIds.
          //             the returned filter will have an array of recordIds
          //             it can only have one filter property

          inputFilters = [{
            protocol : 'some-protocol',
            schema   : 'some-schema',
            recordId : ['some-record-id-1', 'some-record-id-2']
          }];

          filters = FilterSelector.reduceFilters(inputFilters);
          expect(filters.length).to.equal(1);
          expect(filters[0].recordId).to.not.be.undefined;
          expect(filters[0].recordId).to.have.members(['some-record-id-1', 'some-record-id-2']);
        });

        it('returns remaining filters without Ids', async () => {
          const inputFilters:Filter[] = [{
            schema   : 'schema-1',
            recordId : 'some-record-id'
          },{
            schema   : 'schema-2',
            recordId : 'some-record-id-2'
          },{
            schema: 'schema-3', // remaining
          },{
            schema: 'schema-4' //remaining
          }];

          const filters = FilterSelector.reduceFilters(inputFilters);
          const idFilters = filters.filter(filter => filter.recordId !== undefined);
          const remainingFilters = filters.filter(filter => filter.recordId === undefined);
          expect(idFilters.length).to.equal(2);
          expect(idFilters[0].recordId).to.equal('some-record-id');
          expect(Object.keys(idFilters[0]!).length).to.equal(1); // ensure there is only one filter property
          expect(idFilters[1].recordId).to.equal('some-record-id-2');
          expect(Object.keys(idFilters[1]!).length).to.equal(1); // ensure there is only one filter property
          expect(remainingFilters.length).to.equal(2);
          expect(remainingFilters[0].schema).to.equal('schema-3');
          expect(remainingFilters[1].schema).to.equal('schema-4');
        });
      });
    });
  });
});