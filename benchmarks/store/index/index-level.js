import { IndexLevel } from '../../../dist/esm/src/store/index-level.js';
import { v4 as uuid } from 'uuid';

// create

const createStart = Date.now();
const index = new IndexLevel({
  location: 'BENCHMARK-INDEX'
});
await index.open();
const createEnd = Date.now();
console.log('create', createEnd - createStart);

// clear - before

const clearBeforeStart = Date.now();
await index.clear();
const clearBeforeEnd = Date.now();
console.log('clear - before', clearBeforeEnd - clearBeforeStart);

// put

const putStart = Date.now();
await Promise.all(Array(10_000).fill().map(() => index.put(uuid(), {
  test   : 'foo',
  number : Math.random()
})));
const putEnd = Date.now();
console.log('put', putEnd - putStart);

// query - equal

const queryEqualStart = Date.now();
await index.query({
  'test': 'foo'
});
const queryEqualEnd = Date.now();
console.log('query - equal', queryEqualEnd - queryEqualStart);

// query - range

const queryRangeStart = Date.now();
await index.query({
  'number': { gte: 0.5 }
});
const queryRangeEnd = Date.now();
console.log('query - range', queryRangeEnd - queryRangeStart);

// clear - after

const clearAfterStart = Date.now();
await index.clear();
const clearAfterEnd = Date.now();
console.log('clear - after', clearAfterEnd - clearAfterStart);
