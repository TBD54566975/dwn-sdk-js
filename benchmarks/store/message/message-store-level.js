import { MessageStoreLevel } from '../../../dist/esm/src/store/message-store-level.js';
import { TestDataGenerator } from '../../../dist/esm/tests/utils/test-data-generator.js';
import { Time } from '../../../dist/esm/src/utils/time.js';

const tenant = 'did:xyz:alice';
console.log('message store benchmarks');

// pre-generate messages
const insertMessages = Array(10_000).fill().map((_,i) => {
  const mod = i % 3;
  let schema, year;
  switch (mod) {
  case 0:
    schema = 'schema1';
    year = 2022;
    break;
  case 1:
    schema = 'schema2';
    year = 2023;
    break;
  default:
    schema = 'schema3';
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
console.log('\tcreate\t\t\t:', createEnd - createStart);

// clear - before

const clearBeforeStart = Date.now();
await messageStore.clear();
const clearBeforeEnd = Date.now();
console.log('\tclear - before\t\t:', clearBeforeEnd - clearBeforeStart);

// put
const putStart = Date.now();
await Promise.all(insertMessages.map(({ message, indexes }) => messageStore.put(tenant, message, indexes)));
const putEnd = Date.now();
console.log('\tput\t\t\t:', putEnd - putStart);

// query - equal
const queryEqualStart = Date.now();
let { messages } = await messageStore.query(tenant, [{ schema: 'schema2' }]);
const queryEqualEnd = Date.now();
console.log('\tquery - equal\t\t:', queryEqualEnd - queryEqualStart);
console.log('\t\tresults count\t:', messages.length);

// query - equal multiple
const multipleEqualStart = Date.now();
({ messages } = await messageStore.query(tenant, [{ schema: 'schema2' }, { schema: 'schema1' }]));
const multipleEqualEnd = Date.now();
console.log('\tquery - multiple equal\t:', multipleEqualEnd - multipleEqualStart);
console.log('\t\tresults count\t:', messages.length);

// query - range
const lastDayOf2022 = Time.createTimestamp({ year: 2022, month: 12, day: 31 });
const queryRangeStart = Date.now();
({ messages } = await messageStore.query(tenant, [{
  dateCreated: { gt: lastDayOf2022 }
}]));
const queryRangeEnd = Date.now();
console.log('\tquery - range\t\t:', queryRangeEnd - queryRangeStart);
console.log('\t\tresults count\t:', messages.length);

// query - range multiple
const multipleRangeStart = Date.now();
const firstDayOf2024 = Time.createTimestamp({ year: 2024, month: 1, day: 1 });
const lastDayOf2023 = Time.createTimestamp({ year: 2023, month: 12, day: 31 });
({ messages } = await messageStore.query(tenant, [
  { dateCreated: { gt: lastDayOf2022 } },
  { dateCreated: { lt: firstDayOf2024, gt: lastDayOf2023 } }
]));
const multipleRangeEnd = Date.now();
console.log('\tquery - multiple range\t:', multipleRangeEnd - multipleRangeStart);
console.log('\t\tresults count\t:', messages.length);


// clear - after
const clearAfterStart = Date.now();
await messageStore.clear();
const clearAfterEnd = Date.now();
console.log('\tclear - after\t\t:', clearAfterEnd - clearAfterStart);
