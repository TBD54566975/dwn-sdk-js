import { MessageStoreLevel } from '../../../dist/esm/src/store/message-store-level.js';
import { SortDirection } from '../../../dist/esm/src/types/message-types.js';
import { TestDataGenerator } from '../../../dist/esm/tests/utils/test-data-generator.js';
import { Time } from '../../../dist/esm/src/utils/time.js';

const tenant = 'did:xyz:alice';
console.log('message store benchmarks');

const items = 10_000;

// pre-generate messages
const insertMessages = Array(items).fill().map((_,i) => {
  const mod = i % 3;
  const schema = i % 2 === 0 ? 'schema1' : 'schema2';
  let year;
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
    dateCreated,
    recipient : i % Math.floor(items/(items/250)) === 0 ? 'bob' : 'carol',
    author    : i % Math.floor(items/(items/50)) === 0 ? 'bob' : 'alice',
    published : i % Math.floor(items/(items/100)) === 0 ? true : false
  };
  return { message, indexes };
});

// create
const createStart = Date.now();
const messageStore = new MessageStoreLevel({
  location: 'BENCHMARK-INDEX'
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

const firstDayOf2023 = Time.createTimestamp({ year: 2023, month: 1, day: 1 });
const firstDayOf2024 = Time.createTimestamp({ year: 2024, month: 1, day: 1 });

// advanced query
const ascOrder = { messageTimestamp: SortDirection.Ascending };
const descOrder = { messageTimestamp: SortDirection.Descending };

// paginate 10 pages of 20 results for a specific schema
let page = 0;
let paginationMessageCid = undefined;
let messages = [];
const paginationStart = Date.now();
while (page < 10) {
  page++;
  ({ messages, paginationMessageCid } = await messageStore.query(tenant, [
    { schema: 'schema2', dateCreated: { gte: firstDayOf2023 } }
  ], ascOrder, { limit: 20, paginationMessageCid } ));
}
const paginationEnd = Date.now();
console.log('\tpagination\t\t\t:', paginationEnd - paginationStart, 'ms');

page = 0;
paginationMessageCid = undefined;
const paginationDescStart = Date.now();
while (page < 10) {
  page++;
  ({ messages, paginationMessageCid } = await messageStore.query(tenant, [
    { schema: 'schema2', dateCreated: { gte: firstDayOf2023 } }
  ], descOrder, { limit: 20, paginationMessageCid } ));
}
const paginationDescEnd = Date.now();
console.log('\tpagination desc\t\t\t:', paginationDescEnd - paginationDescStart, 'ms');

page = 0;
paginationMessageCid = undefined;
const paginationNonOwnerStart = Date.now();
while (page < 10) {
  page++;
  ({ messages, paginationMessageCid } = await messageStore.query(tenant, [
    { schema: 'schema2', published: false, author: 'bob', dateCreated: { gte: firstDayOf2023 } },
    { schema: 'schema2', published: true, dateCreated: { gte: firstDayOf2023 } },
    { schema: 'schema2', published: false, recipient: 'bob', dateCreated: { gte: firstDayOf2023 } },
  ], ascOrder, { limit: 20, paginationMessageCid } ));
}
const paginationNonOwnerEnd = Date.now();
console.log('\tpagination non owner\t\t:', paginationNonOwnerEnd - paginationNonOwnerStart, 'ms');

page = 0;
paginationMessageCid = undefined;
const paginationDescNonOwnerStart = Date.now();
while (page < 10) {
  page++;
  ({ messages, paginationMessageCid } = await messageStore.query(tenant, [
    { schema: 'schema2', published: false, author: 'bob', dateCreated: { gte: firstDayOf2023 } },
    { schema: 'schema2', published: true, dateCreated: { gte: firstDayOf2023 } },
    { schema: 'schema2', published: false, recipient: 'bob', dateCreated: { gte: firstDayOf2023 } },
  ], descOrder, { limit: 20, paginationMessageCid } ));
}
const paginationDescNonOwnerEnd = Date.now();
console.log('\tpagination desc non owner\t:', paginationDescNonOwnerEnd - paginationDescNonOwnerStart, 'ms');

const smallResultSetStart = Date.now();
({ messages } = await messageStore.query(tenant, [{ published: true, recipient: 'bob' }]));
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
