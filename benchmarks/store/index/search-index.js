import searchIndex from 'search-index';
import { v4 as uuid } from 'uuid';

// create

const createStart = Date.now();
const index = await searchIndex({ name: 'BENCHMARK-INDEX' });
const createEnd = Date.now();
console.log('create', createEnd - createStart);

// clear - before

const clearBeforeStart = Date.now();
await index.FLUSH();
const clearBeforeEnd = Date.now();
console.log('clear - before', clearBeforeEnd - clearBeforeStart);

// put

const putStart = Date.now();
await Promise.all(Array(10_000).fill().map(() => index.PUT([ {
  _id    : uuid(),
  test   : 'foo',
  number : String(Math.random())
} ], { tokenSplitRegex: /.+/ })));
const putEnd = Date.now();
console.log('put', putEnd - putStart);

// query - equal

const queryEqualStart = Date.now();
await index.QUERY({ AND: [ {
  FIELD : 'test',
  VALUE : 'foo'
} ] });
const queryEqualEnd = Date.now();
console.log('query - equal', queryEqualEnd - queryEqualStart);

// query - range

const queryRangeStart = Date.now();
await index.QUERY({ AND: [ {
  FIELD : 'number',
  VALUE : { GTE: '0.5' }
} ] });
const queryRangeEnd = Date.now();
console.log('query - range', queryRangeEnd - queryRangeStart);

const multipleRangeStart = Date.now();
await index.QUERY({ AND: [ {
  FIELD : 'number',
  VALUE : { LTE: '0.1' }
},{
  FIELD : 'number',
  VALUE : { GTE: '0.5' }
} ] });
const multipleRangeEnd = Date.now();
console.log('query - multiple range', multipleRangeEnd - multipleRangeStart);

// clear - after

const clearAfterStart = Date.now();
await index.FLUSH();
const clearAfterEnd = Date.now();
console.log('clear - after', clearAfterEnd - clearAfterStart);
