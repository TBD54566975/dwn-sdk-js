import { MessageStoreLevel } from '../../../dist/esm/src/store/message-store-level.js';
import { SortDirection } from '../../../dist/esm/src/types/message-types.js';
import { TestDataGenerator } from '../../../dist/esm/tests/utils/test-data-generator.js';
import { Time } from '../../../dist/esm/src/utils/time.js';

const tenant = 'did:xyz:alice';
console.log('message store benchmarks');

const items = 70_000;

// pre-generate messages
const insertMessages = Array(items).fill().map((_,i) => {
  // random schema from 1-5
  const schemaId = Math.floor(Math.random() * 5) + 1;
  const schema = `schema${schemaId}`;

  //random protocol from 1-10
  const protocolId = Math.floor(Math.random() * 9);
  const protocol = `proto${protocolId}`;

  const bobId = i % 25;
  const recipient = `bob${bobId + 1}`;
  const author = i % 50 === 0 ? 'bob1' : 'alice';
  const published = i % 100 === 0 ? true : false;

  let year;
  const mod = i % 3;
  switch (mod) {
  case 0:
    year = 2022;
    break;
  case 1:
    year = 2023;
    break;
  default:
    year = 2024;
  }

  const messageTimestamp = TestDataGenerator.randomTimestamp({ year });
  const dateCreated = TestDataGenerator.randomTimestamp({ year });
  const message = {
    descriptor: {
      interface : 'Records',
      method    : 'Write',
      messageTimestamp
    }
  };
  const indexes = {
    ...message.descriptor,
    schema,
    protocol,
    dateCreated,
    recipient,
    author,
    published,
  };
  return { message, indexes };
});

// create
const createStart = Date.now();
const messageStore = new MessageStoreLevel({
  blockstoreLocation : 'BENCHMARK-BLOCK',
  indexLocation      : 'BENCHMARK-INDEX',
});
await messageStore.open();
const createEnd = Date.now();
console.log('\tcreate\t\t\t\t:', createEnd - createStart, 'ms');

// clear - before

const clearBeforeStart = Date.now();
await messageStore.clear();
const clearBeforeEnd = Date.now();
console.log('\tclear - before\t\t\t:', clearBeforeEnd - clearBeforeStart, 'ms');

// put
const putStart = Date.now();
await Promise.all(insertMessages.map(({ message, indexes }) => messageStore.put(tenant, message, indexes)));
const putEnd = Date.now();
console.log('\tput\t\t\t\t:', putEnd - putStart, 'ms');

const firstDayOf2024 = Time.createTimestamp({ year: 2024, month: 1, day: 1 });

// advanced query
const ascOrder = { messageTimestamp: SortDirection.Ascending };
const descOrder = { messageTimestamp: SortDirection.Descending };

// paginate 10 pages of 20 results for a specific schema
// note: published: true is a smaller subset so will perform better if index optimizes for equality filter
let page = 0;
let paginationMessageCid = undefined;
let messages = [];
let results = [];
const paginationStart = Date.now();
while (page < 10) {
  page++;
  ({ messages, paginationMessageCid } = await messageStore.query(tenant, [
    { published: true, schema: 'schema2', protocol: 'proto6' }
  ], ascOrder, { limit: 20, paginationMessageCid } ));
  results.push(...messages);
  if (paginationMessageCid === undefined) {
    break;
  }
}
const paginationEnd = Date.now();
console.log('\tpagination small subset\t\t:', paginationEnd - paginationStart, 'ms', 'results ', results.length);

// descending order
results = [];
page = 0;
paginationMessageCid = undefined;
const paginationDescStart = Date.now();
while (page < 10) {
  page++;
  ({ messages, paginationMessageCid } = await messageStore.query(tenant, [
    { published: true, schema: 'schema2', protocol: 'proto6' }
  ], descOrder, { limit: 20, paginationMessageCid } ));
  results.push(...messages);
  if (paginationMessageCid === undefined) {
    break;
  }
}
const paginationDescEnd = Date.now();
console.log('\tpagination small subset des\t:', paginationDescEnd - paginationDescStart, 'ms', ' results', results.length);

// filter for a larger result set.
results = [];
page = 0;
paginationMessageCid = undefined;
const paginationLargeStart = Date.now();
while (page < 10) {
  page++;
  ({ messages, paginationMessageCid } = await messageStore.query(tenant, [
    { published: true, schema: 'schema2', protocol: 'proto6' },
    { published: false, schema: 'schema2', protocol: 'proto6' }
  ], ascOrder, { limit: 20, paginationMessageCid } ));
  results.push(...messages);
  if (paginationMessageCid === undefined) {
    break;
  }
}
const paginationLargeEnd = Date.now();
console.log('\tpagination large subset\t\t:', paginationLargeEnd - paginationLargeStart, 'ms', ' results', results.length);

// ascending multiple filters. similar to non-owner query
results = [];
page = 0;
paginationMessageCid = undefined;
const paginationNonOwnerStart = Date.now();
while (page < 10) {
  page++;
  ({ messages, paginationMessageCid } = await messageStore.query(tenant, [
    { schema: 'schema2', published: false, author: 'bob1', protocol: 'proto6' },
    { schema: 'schema2', published: true, protocol: 'proto6' },
    { schema: 'schema2', published: false, recipient: 'bob1', protocol: 'proto6' },
  ], ascOrder, { limit: 20, paginationMessageCid } ));
  results.push(...messages);
  if (paginationMessageCid === undefined) {
    break;
  }
}
const paginationNonOwnerEnd = Date.now();
console.log('\tpagination non owner\t\t:', paginationNonOwnerEnd - paginationNonOwnerStart, 'ms', ' results', results.length);

// descending multiple filters. similar to non-owner query
results = [];
page = 0;
paginationMessageCid = undefined;
const paginationDescNonOwnerStart = Date.now();
while (page < 10) {
  page++;
  ({ messages, paginationMessageCid } = await messageStore.query(tenant, [
    { schema: 'schema2', published: false, author: 'bob1', protocol: 'proto6' },
    { schema: 'schema2', published: true, protocol: 'proto6' },
    { schema: 'schema2', published: false, recipient: 'bob1', protocol: 'proto6' },
  ], descOrder, { limit: 20, paginationMessageCid } ));
  results.push(...messages);
  if (paginationMessageCid === undefined) {
    break;
  }
}
const paginationDescNonOwnerEnd = Date.now();
console.log('\tpagination desc non owner\t:', paginationDescNonOwnerEnd - paginationDescNonOwnerStart, 'ms', ' results', results.length);

const smallResultSetStart = Date.now();
({ messages } = await messageStore.query(tenant, [{ published: true, recipient: 'bob1' }]));
const smallResultSetEnd = Date.now();
console.log('\tquery asc - small set equal\t:', smallResultSetEnd - smallResultSetStart, 'ms');
console.log('\t\tresults count\t\t:', messages.length);

const lastDayOf2022 = Time.createTimestamp({ year: 2022, month: 12, day: 31 });
const lastDayOf2023 = Time.createTimestamp({ year: 2023, month: 12, day: 31 });
const queryRangeStart = Date.now();
({ messages } = await messageStore.query(tenant, [{
  dateCreated: { gt: lastDayOf2022, lt: lastDayOf2023 }
}]));
const queryRangeEnd = Date.now();
console.log('\tquery - range\t\t\t:', queryRangeEnd - queryRangeStart, 'ms');
console.log('\t\tresults count\t\t:', messages.length);

// larger result set
const queryEqualStart = Date.now();
({ messages } = await messageStore.query(tenant, [{ schema: 'schema2' }]));
const queryEqualEnd = Date.now();
console.log('\tquery - equal\t\t\t:', queryEqualEnd - queryEqualStart, 'ms');
console.log('\t\tresults count\t\t:', messages.length);

// multiple queries
const multipleEqualStart = Date.now();
({ messages } = await messageStore.query(tenant, [{ schema: ['schema2', 'schema1'] }, { published: true }]));
const multipleEqualEnd = Date.now();
console.log('\tquery - multiple equal\t\t:', multipleEqualEnd - multipleEqualStart, 'ms');
console.log('\t\tresults count\t\t:', messages.length);

//range queries
// gt
const queryGTRangeStart = Date.now();
({ messages } = await messageStore.query(tenant, [{
  dateCreated: { gt: lastDayOf2022 }
}]));
const queryGTRangeEnd = Date.now();
console.log('\tquery - gt range\t\t:', queryGTRangeEnd - queryGTRangeStart, 'ms');
console.log('\t\tresults count\t\t:', messages.length);

// lt
const queryLTRangeStart = Date.now();
({ messages } = await messageStore.query(tenant, [{
  dateCreated: { lt: lastDayOf2022 }
}]));
const queryLTRangeEnd = Date.now();
console.log('\tquery - lt range\t\t:', queryLTRangeEnd - queryLTRangeStart, 'ms');
console.log('\t\tresults count\t\t:', messages.length);

// query - range multiple
const multipleRangeStart = Date.now();
({ messages } = await messageStore.query(tenant, [
  { dateCreated: { gt: lastDayOf2022 } },
  { dateCreated: { lt: firstDayOf2024, gt: lastDayOf2023 } },
]));
const multipleRangeEnd = Date.now();
console.log('\tquery - multiple range\t\t:', multipleRangeEnd - multipleRangeStart, 'ms');
console.log('\t\tresults count\t\t:', messages.length);

// clear - after
const clearAfterStart = Date.now();
await messageStore.clear();
const clearAfterEnd = Date.now();
console.log('\tclear - after\t\t\t:', clearAfterEnd - clearAfterStart, 'ms');
