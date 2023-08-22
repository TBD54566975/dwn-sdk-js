import type { RecordsWriteMessage } from '../../src/index.js';
import type { DataStore, EventLog, MessageStore } from '../../src/index.js';
import type { RecordsQueryReply, RecordsWriteDescriptor } from '../../src/types/records-types.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DidKeyResolver } from '../../src/did/did-key-resolver.js';
import { DwnConstant } from '../../src/core/dwn-constant.js';
import { DwnErrorCode } from '../../src/index.js';
import { Encoder } from '../../src/utils/encoder.js';
import { Jws } from '../../src/utils/jws.js';
import { Message } from '../../src/core/message.js';
import { RecordsDateSort } from '../../src/types/message-types.js';
import { RecordsQuery } from '../../src/interfaces/records-query.js';
import { RecordsQueryHandler } from '../../src/handlers/records-query.js';
import { stubInterface } from 'ts-sinon';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStores } from '../test-stores.js';
import { TestStubGenerator } from '../utils/test-stub-generator.js';
import { toTemporalInstant } from '@js-temporal/polyfill';
import { constructRecordsWriteIndexes, RecordsWriteHandler } from '../../src/handlers/records-write.js';
import { DidResolver, Dwn } from '../../src/index.js';

chai.use(chaiAsPromised);

function createDateString(d: Date): string {
  return toTemporalInstant.call(d).toString({ smallestUnit: 'microseconds' });
}


export function testRecordsQueryHandler(): void {
  describe('RecordsQueryHandler.handle()', () => {
    describe('functional tests', () => {
      let didResolver: DidResolver;
      let messageStore: MessageStore;
      let dataStore: DataStore;
      let eventLog: EventLog;
      let dwn: Dwn;

      // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
      // so that different test suites can reuse the same backend store for testing
      before(async () => {
        didResolver = new DidResolver([new DidKeyResolver()]);

        const stores = TestStores.get();
        messageStore = stores.messageStore;
        dataStore = stores.dataStore;
        eventLog = stores.eventLog;

        dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog });
      });

      beforeEach(async () => {
        sinon.restore(); // wipe all previous stubs/spies/mocks/fakes

        // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
        await messageStore.clear();
        await dataStore.clear();
        await eventLog.clear();
      });

      after(async () => {
        await dwn.close();
      });

      it('should return recordId, descriptor, and attestation', async () => {
        const alice = await TestDataGenerator.generatePersona();
        TestStubGenerator.stubDidResolver(didResolver, [alice]);
        const dataFormat = 'myAwesomeDataFormat';

        const write = await TestDataGenerator.generateRecordsWrite({ author: alice, dataFormat });
        const writeReply = await dwn.processMessage(alice.did, write.message, write.dataStream);
        expect(writeReply.status.code).to.equal(202);

        const query = await TestDataGenerator.generateRecordsQuery({ author: alice, filter: { dataFormat } });
        const reply = await dwn.processMessage(alice.did, query.message) as RecordsQueryReply;

        expect(reply.entries?.length).to.equal(1);
        const entry = reply.entries![0];
        expect(entry.attestation).to.equal(write.message.attestation);
        expect(entry.descriptor).to.deep.equal(write.message.descriptor);
        expect(entry.recordId).to.equal(write.message.recordId);
      });

      it('should return records matching the query', async () => {
      // insert three messages into DB, two with matching protocol
        const alice = await TestDataGenerator.generatePersona();
        const dataFormat = 'myAwesomeDataFormat';
        const write1 = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const write2 = await TestDataGenerator.generateRecordsWrite({ author: alice, dataFormat, schema: 'schema1' });
        const write3 = await TestDataGenerator.generateRecordsWrite({ author: alice, dataFormat, schema: 'schema2' });

        // setting up a stub resolver
        const mockResolution = TestDataGenerator.createDidResolutionResult(alice);;
        sinon.stub(didResolver, 'resolve').resolves(mockResolution);

        // insert data
        const writeReply1 = await dwn.processMessage(alice.did, write1.message, write1.dataStream);
        const writeReply2 = await dwn.processMessage(alice.did, write2.message, write2.dataStream);
        const writeReply3 = await dwn.processMessage(alice.did, write3.message, write3.dataStream);
        expect(writeReply1.status.code).to.equal(202);
        expect(writeReply2.status.code).to.equal(202);
        expect(writeReply3.status.code).to.equal(202);

        // testing singular conditional query
        const messageData = await TestDataGenerator.generateRecordsQuery({ author: alice, filter: { dataFormat } });

        const reply = await dwn.processMessage(alice.did, messageData.message);

        expect(reply.status.code).to.equal(200);
        expect(reply.entries?.length).to.equal(2); // only 2 entries should match the query on protocol

        // testing multi-conditional query, reuse data generated above for bob
        const messageData2 = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            dataFormat,
            schema: 'schema1'
          }
        });

        const reply2 = await dwn.processMessage(alice.did, messageData2.message);

        expect(reply2.status.code).to.equal(200);
        expect(reply2.entries?.length).to.equal(1); // only 1 entry should match the query
      });

      it('should return `encodedData` if data size is within the spec threshold', async () => {
        const data = TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded); // within/on threshold
        const alice = await DidKeyResolver.generate();
        const write= await TestDataGenerator.generateRecordsWrite({ author: alice, data });

        const writeReply = await dwn.processMessage(alice.did, write.message, write.dataStream);
        expect(writeReply.status.code).to.equal(202);

        const messageData = await TestDataGenerator.generateRecordsQuery({ author: alice, filter: { recordId: write.message.recordId } });
        const reply = await dwn.processMessage(alice.did, messageData.message);

        expect(reply.status.code).to.equal(200);
        expect(reply.entries?.length).to.equal(1);
        expect(reply.entries![0].encodedData).to.equal(Encoder.bytesToBase64Url(data));
      });

      it('should not return `encodedData` if data size is greater then spec threshold', async () => {
        const data = TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 1); // exceeding threshold
        const alice = await DidKeyResolver.generate();
        const write= await TestDataGenerator.generateRecordsWrite({ author: alice, data });

        const writeReply = await dwn.processMessage(alice.did, write.message, write.dataStream);
        expect(writeReply.status.code).to.equal(202);

        const messageData = await TestDataGenerator.generateRecordsQuery({ author: alice, filter: { recordId: write.message.recordId } });
        const reply = await dwn.processMessage(alice.did, messageData.message);

        expect(reply.status.code).to.equal(200);
        expect(reply.entries?.length).to.equal(1);
        expect(reply.entries![0].encodedData).to.be.undefined;
      });

      it('should be able to query by attester', async () => {
      // scenario: 2 records authored by alice, 1st attested by alice, 2nd attested by bob
        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();
        const recordsWrite1 = await TestDataGenerator.generateRecordsWrite({ author: alice, attesters: [alice] });
        const recordsWrite2 = await TestDataGenerator.generateRecordsWrite({ author: alice, attesters: [bob] });

        // insert data
        const writeReply1 = await dwn.processMessage(alice.did, recordsWrite1.message, recordsWrite1.dataStream);
        const writeReply2 = await dwn.processMessage(alice.did, recordsWrite2.message, recordsWrite2.dataStream);
        expect(writeReply1.status.code).to.equal(202);
        expect(writeReply2.status.code).to.equal(202);

        // testing attester filter
        const recordsQuery1 = await TestDataGenerator.generateRecordsQuery({ author: alice, filter: { attester: alice.did } });
        const reply1 = await dwn.processMessage(alice.did, recordsQuery1.message);
        expect(reply1.entries?.length).to.equal(1);
        const reply1Attester = Jws.getSignerDid((reply1.entries![0] as RecordsWriteMessage).attestation!.signatures[0]);
        expect(reply1Attester).to.equal(alice.did);

        // testing attester + another filter
        const recordsQuery2 = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { attester: bob.did, schema: recordsWrite2.message.descriptor.schema }
        });
        const reply2 = await dwn.processMessage(alice.did, recordsQuery2.message);
        expect(reply2.entries?.length).to.equal(1);
        const reply2Attester = Jws.getSignerDid((reply2.entries![0] as RecordsWriteMessage).attestation!.signatures[0]);
        expect(reply2Attester).to.equal(bob.did);

        // testing attester filter that yields no results
        const carol = await DidKeyResolver.generate();
        const recordsQuery3 = await TestDataGenerator.generateRecordsQuery({ author: alice, filter: { attester: carol.did } });
        const reply3 = await dwn.processMessage(alice.did, recordsQuery3.message);
        expect(reply3.entries?.length).to.equal(0);
      });

      it('should be able to range query by `dateCreated`', async () => {
      // scenario: 3 records authored by alice, created on first of 2021, 2022, and 2023 respectively, only the first 2 records share the same schema
        const firstDayOf2021 = createDateString(new Date(2021, 1, 1));
        const firstDayOf2022 = createDateString(new Date(2022, 1, 1));
        const firstDayOf2023 = createDateString(new Date(2023, 1, 1));
        const alice = await DidKeyResolver.generate();
        const write1 = await TestDataGenerator.generateRecordsWrite({ author: alice, dateCreated: firstDayOf2021, messageTimestamp: firstDayOf2021 });
        const write2 = await TestDataGenerator.generateRecordsWrite({ author: alice, dateCreated: firstDayOf2022, messageTimestamp: firstDayOf2022 });
        const write3 = await TestDataGenerator.generateRecordsWrite({ author: alice, dateCreated: firstDayOf2023, messageTimestamp: firstDayOf2023 });

        // insert data
        const writeReply1 = await dwn.processMessage(alice.did, write1.message, write1.dataStream);
        const writeReply2 = await dwn.processMessage(alice.did, write2.message, write2.dataStream);
        const writeReply3 = await dwn.processMessage(alice.did, write3.message, write3.dataStream);
        expect(writeReply1.status.code).to.equal(202);
        expect(writeReply2.status.code).to.equal(202);
        expect(writeReply3.status.code).to.equal(202);

        // testing `from` range
        const lastDayOf2021 = createDateString(new Date(2021, 12, 31));
        const recordsQuery1 = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          filter   : { dateCreated: { from: lastDayOf2021 } },
          dateSort : RecordsDateSort.CreatedAscending
        });
        const reply1 = await dwn.processMessage(alice.did, recordsQuery1.message);
        expect(reply1.entries?.length).to.equal(2);
        expect(reply1.entries![0].encodedData).to.equal(Encoder.bytesToBase64Url(write2.dataBytes!));
        expect(reply1.entries![1].encodedData).to.equal(Encoder.bytesToBase64Url(write3.dataBytes!));

        // testing `to` range
        const lastDayOf2022 = createDateString(new Date(2022, 12, 31));
        const recordsQuery2 = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          filter   : { dateCreated: { to: lastDayOf2022 } },
          dateSort : RecordsDateSort.CreatedAscending
        });
        const reply2 = await dwn.processMessage(alice.did, recordsQuery2.message);
        expect(reply2.entries?.length).to.equal(2);
        expect(reply2.entries![0].encodedData).to.equal(Encoder.bytesToBase64Url(write1.dataBytes!));
        expect(reply2.entries![1].encodedData).to.equal(Encoder.bytesToBase64Url(write2.dataBytes!));

        // testing `from` and `to` range
        const lastDayOf2023 = createDateString(new Date(2023, 12, 31));
        const recordsQuery3 = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          filter   : { dateCreated: { from: lastDayOf2022, to: lastDayOf2023 } },
          dateSort : RecordsDateSort.CreatedAscending
        });
        const reply3 = await dwn.processMessage(alice.did, recordsQuery3.message);
        expect(reply3.entries?.length).to.equal(1);
        expect(reply3.entries![0].encodedData).to.equal(Encoder.bytesToBase64Url(write3.dataBytes!));

        // testing edge case where value equals `from` and `to`
        const recordsQuery4 = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          filter   : { dateCreated: { from: firstDayOf2022, to: firstDayOf2023 } },
          dateSort : RecordsDateSort.CreatedAscending
        });
        const reply4 = await dwn.processMessage(alice.did, recordsQuery4.message);
        expect(reply4.entries?.length).to.equal(1);
        expect(reply4.entries![0].encodedData).to.equal(Encoder.bytesToBase64Url(write2.dataBytes!));
      });

      it('should be able use range and exact match queries at the same time', async () => {
      // scenario: 3 records authored by alice, created on first of 2021, 2022, and 2023 respectively, only the first 2 records share the same schema
        const firstDayOf2021 = createDateString(new Date(2021, 1, 1));
        const firstDayOf2022 = createDateString(new Date(2022, 1, 1));
        const firstDayOf2023 = createDateString(new Date(2023, 1, 1));
        const alice = await DidKeyResolver.generate();
        const schema = '2021And2022Schema';
        const write1 = await TestDataGenerator.generateRecordsWrite({
          author: alice, dateCreated: firstDayOf2021, messageTimestamp: firstDayOf2021, schema
        });
        const write2 = await TestDataGenerator.generateRecordsWrite({
          author: alice, dateCreated: firstDayOf2022, messageTimestamp: firstDayOf2022, schema
        });
        const write3 = await TestDataGenerator.generateRecordsWrite({
          author: alice, dateCreated: firstDayOf2023, messageTimestamp: firstDayOf2023
        });

        // insert data
        const writeReply1 = await dwn.processMessage(alice.did, write1.message, write1.dataStream);
        const writeReply2 = await dwn.processMessage(alice.did, write2.message, write2.dataStream);
        const writeReply3 = await dwn.processMessage(alice.did, write3.message, write3.dataStream);
        expect(writeReply1.status.code).to.equal(202);
        expect(writeReply2.status.code).to.equal(202);
        expect(writeReply3.status.code).to.equal(202);

        // testing range criterion with another exact match
        const lastDayOf2021 = createDateString(new Date(2021, 12, 31));
        const lastDayOf2023 = createDateString(new Date(2023, 12, 31));
        const recordsQuery5 = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            schema, // by itself selects the first 2 records
            dateCreated: { from: lastDayOf2021, to: lastDayOf2023 } // by itself selects the last 2 records
          },
          dateSort: RecordsDateSort.CreatedAscending
        });
        const reply = await dwn.processMessage(alice.did, recordsQuery5.message);
        expect(reply.entries?.length).to.equal(1);
        expect(reply.entries![0].encodedData).to.equal(Encoder.bytesToBase64Url(write2.dataBytes!));
      });

      it('should not include `authorization` in returned records', async () => {
        const alice = await TestDataGenerator.generatePersona();
        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice });

        // setting up a stub method resolver
        const mockResolution = TestDataGenerator.createDidResolutionResult(alice);
        sinon.stub(didResolver, 'resolve').resolves(mockResolution);

        const writeReply = await dwn.processMessage(alice.did, message, dataStream);
        expect(writeReply.status.code).to.equal(202);

        const queryData = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { schema: message.descriptor.schema }
        });

        const queryReply = await dwn.processMessage(alice.did, queryData.message);
        expect(queryReply.status.code).to.equal(200);
        expect(queryReply.entries?.length).to.equal(1);
        expect((queryReply.entries![0] as any).authorization).to.equal(undefined);
      });

      it('should include `attestation` in returned records', async () => {
      // scenario: alice and bob attest to a message alice authored

        const alice = await DidKeyResolver.generate();
        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice, attesters: [alice] });

        const writeReply = await dwn.processMessage(alice.did, message, dataStream);
        expect(writeReply.status.code).to.equal(202);

        const queryData = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { schema: message.descriptor.schema }
        });

        const queryReply = await dwn.processMessage(alice.did, queryData.message);
        expect(queryReply.status.code).to.equal(200);
        expect(queryReply.entries?.length).to.equal(1);

        const recordsWriteMessage = queryReply.entries![0] as any;
        expect(recordsWriteMessage.attestation?.signatures?.length).to.equal(1);
      });

      it('should omit records that are not published if `dateSort` sorts on `datePublished`', async () => {
      // insert three messages into DB, two with matching protocol
        const alice = await TestDataGenerator.generatePersona();
        const schema = 'aSchema';
        const publishedWriteData = await TestDataGenerator.generateRecordsWrite({
          author: alice, schema, published: true
        });
        const unpublishedWriteData = await TestDataGenerator.generateRecordsWrite({
          author: alice, schema
        });

        // setting up a stub method resolver
        const mockResolution = TestDataGenerator.createDidResolutionResult(alice);;
        sinon.stub(didResolver, 'resolve').resolves(mockResolution);

        // insert data
        const publishedWriteReply = await dwn.processMessage(alice.did, publishedWriteData.message, publishedWriteData.dataStream);
        const unpublishedWriteReply = await dwn.processMessage(alice.did, unpublishedWriteData.message, unpublishedWriteData.dataStream);
        expect(publishedWriteReply.status.code).to.equal(202);
        expect(unpublishedWriteReply.status.code).to.equal(202);

        // test published date ascending sort does not include any records that is not published
        const publishedAscendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          dateSort : RecordsDateSort.PublishedAscending,
          filter   : { schema }
        });
        const publishedAscendingQueryReply = await dwn.handleRecordsQuery(alice.did, publishedAscendingQueryData.message);

        expect(publishedAscendingQueryReply.entries?.length).to.equal(1);
        expect(publishedAscendingQueryReply.entries![0].descriptor['datePublished']).to.equal(publishedWriteData.message.descriptor.datePublished);

        // test published date scending sort does not include any records that is not published
        const publishedDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          dateSort : RecordsDateSort.PublishedDescending,
          filter   : { schema }
        });
        const publishedDescendingQueryReply = await dwn.handleRecordsQuery(alice.did, publishedDescendingQueryData.message);

        expect(publishedDescendingQueryReply.entries?.length).to.equal(1);
        expect(publishedDescendingQueryReply.entries![0].descriptor['datePublished']).to.equal(publishedWriteData.message.descriptor.datePublished);
      });

      it('should sort records if `dateSort` is specified', async () => {
      // insert three messages into DB, two with matching protocol
        const alice = await TestDataGenerator.generatePersona();
        const schema = 'aSchema';
        const published = true;
        const write1Data = await TestDataGenerator.generateRecordsWrite({ author: alice, schema, published });
        const write2Data = await TestDataGenerator.generateRecordsWrite({ author: alice, schema, published });
        const write3Data = await TestDataGenerator.generateRecordsWrite({ author: alice, schema, published });

        // setting up a stub method resolver
        const mockResolution = TestDataGenerator.createDidResolutionResult(alice);;
        sinon.stub(didResolver, 'resolve').resolves(mockResolution);

        // insert data, intentionally out of order
        const writeReply2 = await dwn.processMessage(alice.did, write2Data.message, write2Data.dataStream);
        const writeReply1 = await dwn.processMessage(alice.did, write1Data.message, write1Data.dataStream);
        const writeReply3 = await dwn.processMessage(alice.did, write3Data.message, write3Data.dataStream);
        expect(writeReply1.status.code).to.equal(202);
        expect(writeReply2.status.code).to.equal(202);
        expect(writeReply3.status.code).to.equal(202);

        // createdAscending test
        const createdAscendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          dateSort : RecordsDateSort.CreatedAscending,
          filter   : { schema }
        });
        const createdAscendingQueryReply = await dwn.handleRecordsQuery(alice.did, createdAscendingQueryData.message);

        expect(createdAscendingQueryReply.entries?.[0].descriptor['dateCreated']).to.equal(write1Data.message.descriptor.dateCreated);
        expect(createdAscendingQueryReply.entries?.[1].descriptor['dateCreated']).to.equal(write2Data.message.descriptor.dateCreated);
        expect(createdAscendingQueryReply.entries?.[2].descriptor['dateCreated']).to.equal(write3Data.message.descriptor.dateCreated);

        // createdDescending test
        const createdDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          dateSort : RecordsDateSort.CreatedDescending,
          filter   : { schema }
        });
        const createdDescendingQueryReply = await dwn.handleRecordsQuery(alice.did, createdDescendingQueryData.message);

        expect(createdDescendingQueryReply.entries?.[0].descriptor['dateCreated']).to.equal(write3Data.message.descriptor.dateCreated);
        expect(createdDescendingQueryReply.entries?.[1].descriptor['dateCreated']).to.equal(write2Data.message.descriptor.dateCreated);
        expect(createdDescendingQueryReply.entries?.[2].descriptor['dateCreated']).to.equal(write1Data.message.descriptor.dateCreated);

        // publishedAscending test
        const publishedAscendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          dateSort : RecordsDateSort.PublishedAscending,
          filter   : { schema }
        });
        const publishedAscendingQueryReply = await dwn.handleRecordsQuery(alice.did, publishedAscendingQueryData.message);

        expect(publishedAscendingQueryReply.entries?.[0].descriptor['datePublished']).to.equal(write1Data.message.descriptor.datePublished);
        expect(publishedAscendingQueryReply.entries?.[1].descriptor['datePublished']).to.equal(write2Data.message.descriptor.datePublished);
        expect(publishedAscendingQueryReply.entries?.[2].descriptor['datePublished']).to.equal(write3Data.message.descriptor.datePublished);

        // publishedDescending test
        const publishedDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          dateSort : RecordsDateSort.PublishedDescending,
          filter   : { schema }
        });
        const publishedDescendingQueryReply = await dwn.handleRecordsQuery(alice.did, publishedDescendingQueryData.message);

        expect(publishedDescendingQueryReply.entries?.[0].descriptor['datePublished']).to.equal(write3Data.message.descriptor.datePublished);
        expect(publishedDescendingQueryReply.entries?.[1].descriptor['datePublished']).to.equal(write2Data.message.descriptor.datePublished);
        expect(publishedDescendingQueryReply.entries?.[2].descriptor['datePublished']).to.equal(write1Data.message.descriptor.datePublished);
      });
      it('should paginate records if pagination is provided', async () => {
        const alice = await DidKeyResolver.generate();

        const messages = await Promise.all(Array(12).fill({}).map(_ => TestDataGenerator.generateRecordsWrite({
          author : alice,
          schema : 'https://schema'
        })));
        for (const message of messages) {
          const result = await dwn.processMessage(alice.did, message.message, message.dataStream);
          expect(result.status.code).to.equal(202);
        }

        const limit = 5;
        const pages = Math.ceil(messages.length / limit);
        const resultIds: string[] = [];

        for (let i = 0; i < pages; i++) {
          const pageQuery = await TestDataGenerator.generateRecordsQuery({
            author : alice,
            filter : {
              schema: 'https://schema'
            },
            pagination: {
              limit  : limit,
              offset : i * limit
            },
          });
          const pageReply = await dwn.handleRecordsQuery(alice.did, pageQuery.message);
          expect(pageReply.status.code).to.equal(200);
          expect(pageReply.entries?.length).to.be.lte(limit);
          pageReply.entries?.forEach(e => resultIds.push(e.recordId));
        }
        expect(resultIds.length).to.equal(messages.length);
        expect(messages.every(({ message }) => resultIds.includes(message.recordId)));
      });

      it('should allow an anonymous unauthenticated query to return published records', async () => {
      // write 2 records into Alice's DB:
      // 1st is unpublished
      // 2nd is published
        const alice = await DidKeyResolver.generate();
        const record1Data = await TestDataGenerator.generateRecordsWrite(
          { author: alice, schema: 'https://schema1', published: false }
        );
        const record2Data = await TestDataGenerator.generateRecordsWrite(
          { author: alice, schema: 'https://schema2', published: true }
        );

        const recordsWrite1Reply = await dwn.processMessage(alice.did, record1Data.message, record1Data.dataStream);
        expect(recordsWrite1Reply.status.code).to.equal(202);
        const recordsWrite2Reply = await dwn.processMessage(alice.did, record2Data.message, record2Data.dataStream);
        expect(recordsWrite2Reply.status.code).to.equal(202);

        // test correctness for anonymous query
        const anonymousQueryMessageData = await TestDataGenerator.generateRecordsQuery({
          anonymous : true,
          filter    : { dateCreated: { from: '2000-01-01T10:20:30.123456Z' } }
        });

        // sanity check
        expect(anonymousQueryMessageData.message.authorization).to.not.exist;

        const replyToQuery= await dwn.processMessage(alice.did, anonymousQueryMessageData.message);

        expect(replyToQuery.status.code).to.equal(200);
        expect(replyToQuery.entries?.length).to.equal(1);
        expect((replyToQuery.entries![0].descriptor as RecordsWriteDescriptor).schema).to.equal('https://schema2');
      });

      it('should only return published records and unpublished records that is meant for author', async () => {
      // write 4 records into Alice's DB:
      // 1st is unpublished authored by Alice
      // 2nd is also unpublished authored by Alice, but is meant for (has recipient as) Bob
      // 3rd is also unpublished but is authored by Bob
      // 4th is published
        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();
        const schema = 'schema1';
        const record1Data = await TestDataGenerator.generateRecordsWrite(
          { author: alice, schema, data: Encoder.stringToBytes('1') }
        );
        const record2Data = await TestDataGenerator.generateRecordsWrite(
          { author: alice, schema, protocol: 'protocol', protocolPath: 'path', recipient: bob.did, data: Encoder.stringToBytes('2') }
        );
        const record3Data = await TestDataGenerator.generateRecordsWrite(
          { author: bob, schema, protocol: 'protocol', protocolPath: 'path', recipient: alice.did, data: Encoder.stringToBytes('3') }
        );
        const record4Data = await TestDataGenerator.generateRecordsWrite(
          { author: alice, schema, data: Encoder.stringToBytes('4'), published: true }
        );

        // directly inserting data to datastore so that we don't have to setup to grant Bob permission to write to Alice's DWN
        const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog);

        const additionalIndexes1 = await constructRecordsWriteIndexes(record1Data.recordsWrite, true);
        record1Data.message = await recordsWriteHandler.processEncodedData(record1Data.message, record1Data.dataStream);
        await messageStore.put(alice.did, record1Data.message, additionalIndexes1);
        await eventLog.append(alice.did, await Message.getCid(record1Data.message));

        const additionalIndexes2 = await constructRecordsWriteIndexes(record2Data.recordsWrite, true);
        record2Data.message = await recordsWriteHandler.processEncodedData(record2Data.message, record2Data.dataStream);
        await messageStore.put(alice.did, record2Data.message, additionalIndexes2);
        await eventLog.append(alice.did, await Message.getCid(record2Data.message));

        const additionalIndexes3 = await constructRecordsWriteIndexes(record3Data.recordsWrite, true);
        record3Data.message = await recordsWriteHandler.processEncodedData(record3Data.message, record3Data.dataStream);
        await messageStore.put(alice.did, record3Data.message, additionalIndexes3);
        await eventLog.append(alice.did, await Message.getCid(record3Data.message));

        const additionalIndexes4 = await constructRecordsWriteIndexes(record4Data.recordsWrite, true);
        record4Data.message = await recordsWriteHandler.processEncodedData(record4Data.message, record4Data.dataStream);
        await messageStore.put(alice.did, record4Data.message, additionalIndexes4);
        await eventLog.append(alice.did, await Message.getCid(record4Data.message));

        // test correctness for Bob's query
        const bobQueryMessageData = await TestDataGenerator.generateRecordsQuery({
          author : bob,
          filter : { schema }
        });

        const replyToBob = await dwn.processMessage(alice.did, bobQueryMessageData.message);

        expect(replyToBob.status.code).to.equal(200);
        expect(replyToBob.entries?.length).to.equal(3); // expect 3 records

        const privateRecordsForBob = replyToBob.entries?.filter(message => message.encodedData === Encoder.stringToBase64Url('2'))!;
        const privateRecordsFromBob = replyToBob.entries?.filter(message => message.encodedData === Encoder.stringToBase64Url('3'))!;
        const publicRecords = replyToBob.entries?.filter(message => message.encodedData === Encoder.stringToBase64Url('4'))!;
        expect(privateRecordsForBob.length).to.equal(1);
        expect(privateRecordsFromBob.length).to.equal(1);
        expect(publicRecords.length).to.equal(1);

        // test correctness for Alice's query
        const aliceQueryMessageData = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { schema }
        });

        const replyToAliceQuery = await dwn.processMessage(alice.did, aliceQueryMessageData.message);

        expect(replyToAliceQuery.status.code).to.equal(200);
        expect(replyToAliceQuery.entries?.length).to.equal(4); // expect all 4 records
      });

      // https://github.com/TBD54566975/dwn-sdk-js/issues/170
      it('#170 - should treat records with `published` explicitly set to `false` as unpublished', async () => {
        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();
        const schema = 'schema1';
        const unpublishedRecordsWrite = await TestDataGenerator.generateRecordsWrite(
          { author: alice, schema, data: Encoder.stringToBytes('1'), published: false } // explicitly setting `published` to `false`
        );

        const result1 = await dwn.processMessage(alice.did, unpublishedRecordsWrite.message, unpublishedRecordsWrite.dataStream);
        expect(result1.status.code).to.equal(202);

        // alice should be able to see the unpublished record
        const queryByAlice = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { schema }
        });
        const replyToAliceQuery = await dwn.processMessage(alice.did, queryByAlice.message);
        expect(replyToAliceQuery.status.code).to.equal(200);
        expect(replyToAliceQuery.entries?.length).to.equal(1);

        // actual test: bob should not be able to see unpublished record
        const queryByBob = await TestDataGenerator.generateRecordsQuery({
          author : bob,
          filter : { schema }
        });
        const replyToBobQuery = await dwn.processMessage(alice.did, queryByBob.message);
        expect(replyToBobQuery.status.code).to.equal(200);
        expect(replyToBobQuery.entries?.length).to.equal(0);
      });

      it('should allow DWN owner to use `recipient` as a filter in queries', async () => {
        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();

        const bobQueryMessageData = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { recipient: bob.did } // alice as the DWN owner querying bob's records
        });

        const replyToBobQuery = await dwn.processMessage(alice.did, bobQueryMessageData.message);

        expect(replyToBobQuery.status.code).to.equal(200);
      });

      it('should not fetch entries across tenants', async () => {
      // insert three messages into DB, two with matching schema
        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();
        const schema = 'myAwesomeSchema';
        const recordsWriteMessage1Data = await TestDataGenerator.generateRecordsWrite({ author: alice, schema });
        const recordsWriteMessage2Data = await TestDataGenerator.generateRecordsWrite({ author: bob, schema });

        const aliceQueryMessageData = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { schema }
        });

        // insert data into 2 different tenants
        await dwn.processMessage(alice.did, recordsWriteMessage1Data.message, recordsWriteMessage1Data.dataStream);
        await dwn.processMessage(bob.did, recordsWriteMessage2Data.message, recordsWriteMessage2Data.dataStream);

        const reply = await dwn.processMessage(alice.did, aliceQueryMessageData.message);

        expect(reply.status.code).to.equal(200);
        expect(reply.entries?.length).to.equal(1);
      });

      it('should return 400 if protocol is not normalized', async () => {
        const alice = await DidKeyResolver.generate();

        // query for non-normalized protocol
        const recordsQuery = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { protocol: 'example.com/' },
        });

        // overwrite protocol because #create auto-normalizes protocol
        recordsQuery.message.descriptor.filter.protocol = 'example.com/';

        // Re-create auth because we altered the descriptor after signing
        recordsQuery.message.authorization = await Message.signAsAuthorization(
          recordsQuery.message.descriptor,
          Jws.createSignatureInput(alice)
        );

        // Send records write message
        const reply = await dwn.processMessage(alice.did, recordsQuery.message);
        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain(DwnErrorCode.UrlProtocolNotNormalized);
      });

      it('should return 400 if schema is not normalized', async () => {
        const alice = await DidKeyResolver.generate();

        // query for non-normalized schema
        const recordsQuery = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { schema: 'example.com/' },
        });

        // overwrite schema because #create auto-normalizes schema
        recordsQuery.message.descriptor.filter.schema = 'example.com/';

        // Re-create auth because we altered the descriptor after signing
        recordsQuery.message.authorization = await Message.signAsAuthorization(
          recordsQuery.message.descriptor,
          Jws.createSignatureInput(alice)
        );

        // Send records write message
        const reply = await dwn.processMessage(alice.did, recordsQuery.message);
        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain(DwnErrorCode.UrlSchemaNotNormalized);
      });
    });

    it('should return 401 if signature check fails', async () => {
      const { author, message } = await TestDataGenerator.generateRecordsQuery();
      const tenant = author!.did;

      // setting up a stub did resolver & message store
      // intentionally not supplying the public key so a different public key is generated to simulate invalid signature
      const mismatchingPersona = await TestDataGenerator.generatePersona({ did: author!.did, keyId: author!.keyId });
      const didResolver = TestStubGenerator.createDidResolverStub(mismatchingPersona);
      const messageStore = stubInterface<MessageStore>();
      const dataStore = stubInterface<DataStore>();

      const recordsQueryHandler = new RecordsQueryHandler(didResolver, messageStore, dataStore);
      const reply = await recordsQueryHandler.handle({ tenant, message });

      expect(reply.status.code).to.equal(401);
    });

    it('should return 400 if fail parsing the message', async () => {
      const { author, message } = await TestDataGenerator.generateRecordsQuery();
      const tenant = author!.did;

      // setting up a stub method resolver & message store
      const didResolver = TestStubGenerator.createDidResolverStub(author!);
      const messageStore = stubInterface<MessageStore>();
      const dataStore = stubInterface<DataStore>();
      const recordsQueryHandler = new RecordsQueryHandler(didResolver, messageStore, dataStore);

      // stub the `parse()` function to throw an error
      sinon.stub(RecordsQuery, 'parse').throws('anyError');
      const reply = await recordsQueryHandler.handle({ tenant, message });

      expect(reply.status.code).to.equal(400);
    });
  });
}