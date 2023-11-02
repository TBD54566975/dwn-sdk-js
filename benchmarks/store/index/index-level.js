import { IndexLevel } from '../../../dist/esm/src/store/index-level.js';
import { v4 as uuid } from 'uuid';

const tenant = 'did:xyz:alice';

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
await Promise.all(Array(10_000).fill().map((_,i) => {
  const id = uuid();
  const doc = { test: 'foo', number: Math.random() };
  return index.put(tenant, id, doc, doc, { index: i, number: Math.random(), id });
}));
const putEnd = Date.now();
console.log('put', putEnd - putStart);

// query - equal

const queryEqualStart = Date.now();
await index.query(tenant, [{
  'test': 'foo'
}], { sortProperty: 'id' });
const queryEqualEnd = Date.now();
console.log('query - equal', queryEqualEnd - queryEqualStart);

// query - range

const queryRangeStart = Date.now();
await index.query(tenant, [{
  'number': { gte: 0.5 }
}],{ sortProperty: 'id' });
const queryRangeEnd = Date.now();
console.log('query - range', queryRangeEnd - queryRangeStart);

const multipleRangeStart = Date.now();
await index.query(tenant, [
  { 'number': { lte: 0.1 } },
  { 'number': { gte: 0.5 } }
],{ sortProperty: 'id' });
const multipleRangeEnd = Date.now();
console.log('query - multiple range', multipleRangeEnd - multipleRangeStart);

// clear - after

const clearAfterStart = Date.now();
await index.clear();
const clearAfterEnd = Date.now();
console.log('clear - after', clearAfterEnd - clearAfterStart);
