import type { DataStore, EventLog, MessageStore } from '../../src/index.js';
import type { GenericMessage, RecordsWriteMessage } from '../../src/index.js';
import type { RecordsQueryReply, RecordsQueryReplyEntry, RecordsWriteDescriptor } from '../../src/types/records-types.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import friendRoleProtocolDefinition from '../vectors/protocol-definitions/friend-role.json' assert { type: 'json' };
import threadRoleProtocolDefinition from '../vectors/protocol-definitions/thread-role.json' assert { type: 'json' };

import { ArrayUtility } from '../../src/utils/array.js';
import { DidKeyResolver } from '../../src/did/did-key-resolver.js';
import { DwnConstant } from '../../src/core/dwn-constant.js';
import { Encoder } from '../../src/utils/encoder.js';
import { Jws } from '../../src/utils/jws.js';
import { Message } from '../../src/core/message.js';
import { RecordsQueryHandler } from '../../src/handlers/records-query.js';
import { SortOrder } from '../../src/types/message-types.js';
import { stubInterface } from 'ts-sinon';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStores } from '../test-stores.js';
import { TestStubGenerator } from '../utils/test-stub-generator.js';
import { toTemporalInstant } from '@js-temporal/polyfill';
import { constructRecordsWriteIndexes, RecordsWriteHandler } from '../../src/handlers/records-write.js';
import { DateSort, RecordsQuery } from '../../src/interfaces/records-query.js';
import { DidResolver, Dwn } from '../../src/index.js';
import { DwnErrorCode, MessageStoreLevel } from '../../src/index.js';

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

      it('should return recordId, descriptor, authorization and attestation', async () => {
        const alice = await TestDataGenerator.generatePersona();
        const bob = await TestDataGenerator.generatePersona();
        TestStubGenerator.stubDidResolver(didResolver, [alice, bob]);
        const dataFormat = 'myAwesomeDataFormat';

        const write = await TestDataGenerator.generateRecordsWrite({ author: alice, attesters: [bob], dataFormat });
        const writeReply = await dwn.processMessage(alice.did, write.message, write.dataStream);
        expect(writeReply.status.code).to.equal(202);

        const query = await TestDataGenerator.generateRecordsQuery({ author: alice, filter: { dataFormat } });
        const reply = await dwn.processMessage(alice.did, query.message);

        expect(reply.entries?.length).to.equal(1);
        const entry = reply.entries![0];
        expect(entry.authorization).to.deep.equal(write.message.authorization);
        expect(entry.attestation).to.deep.equal(write.message.attestation);
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

      it('should be able to query with `dataSize` filter (half-open range)', async () => {
        const alice = await DidKeyResolver.generate();
        const write1 = await TestDataGenerator.generateRecordsWrite({ author: alice, data: TestDataGenerator.randomBytes(10) });
        const write2 = await TestDataGenerator.generateRecordsWrite({ author: alice, data: TestDataGenerator.randomBytes(50) });
        const write3 = await TestDataGenerator.generateRecordsWrite({ author: alice, data: TestDataGenerator.randomBytes(100) });

        // insert data
        const writeReply1 = await dwn.processMessage(alice.did, write1.message, write1.dataStream);
        const writeReply2 = await dwn.processMessage(alice.did, write2.message, write2.dataStream);
        const writeReply3 = await dwn.processMessage(alice.did, write3.message, write3.dataStream);
        expect(writeReply1.status.code).to.equal(202);
        expect(writeReply2.status.code).to.equal(202);
        expect(writeReply3.status.code).to.equal(202);

        // testing gt
        const recordsQuery1 = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { dataSize: { gt: 10 } },
        });
        const reply1 = await dwn.processMessage(alice.did, recordsQuery1.message);
        expect(reply1.entries?.length).to.equal(2);

        expect(
          reply1.entries?.map((entry) => entry.encodedData)
        ).to.have.members([
          Encoder.bytesToBase64Url(write2.dataBytes!),
          Encoder.bytesToBase64Url(write3.dataBytes!)
        ]);

        // testing lt
        const recordsQuery2 = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { dataSize: { lt: 100 } },
        });
        const reply2 = await dwn.processMessage(alice.did, recordsQuery2.message);
        expect(reply2.entries?.length).to.equal(2);
        expect(
          reply2.entries?.map((entry) => entry.encodedData)
        ).to.have.members([
          Encoder.bytesToBase64Url(write1.dataBytes!),
          Encoder.bytesToBase64Url(write2.dataBytes!)
        ]);

        // testing gte
        const recordsQuery3 = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { dataSize: { gte: 10 } },
        });
        const reply3 = await dwn.processMessage(alice.did, recordsQuery3.message);
        expect(reply3.entries?.length).to.equal(3);
        expect(
          reply3.entries?.map((entry) => entry.encodedData)
        ).to.have.members([
          Encoder.bytesToBase64Url(write1.dataBytes!),
          Encoder.bytesToBase64Url(write2.dataBytes!),
          Encoder.bytesToBase64Url(write3.dataBytes!)
        ]);

        // testing lte
        const recordsQuery4 = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { dataSize: { lte: 100 } },
        });
        const reply4 = await dwn.processMessage(alice.did, recordsQuery4.message);
        expect(reply4.entries?.length).to.equal(3);
        expect(
          reply4.entries?.map((entry) => entry.encodedData)
        ).to.have.members([
          Encoder.bytesToBase64Url(write1.dataBytes!),
          Encoder.bytesToBase64Url(write2.dataBytes!),
          Encoder.bytesToBase64Url(write3.dataBytes!)
        ]);
      });

      it('should be able to range query with `dataSize` filter (open & closed range)', async () => {
        const alice = await DidKeyResolver.generate();
        const write1 = await TestDataGenerator.generateRecordsWrite({ author: alice, data: TestDataGenerator.randomBytes(10) });
        const write2 = await TestDataGenerator.generateRecordsWrite({ author: alice, data: TestDataGenerator.randomBytes(50) });
        const write3 = await TestDataGenerator.generateRecordsWrite({ author: alice, data: TestDataGenerator.randomBytes(100) });

        // insert data
        const writeReply1 = await dwn.processMessage(alice.did, write1.message, write1.dataStream);
        const writeReply2 = await dwn.processMessage(alice.did, write2.message, write2.dataStream);
        const writeReply3 = await dwn.processMessage(alice.did, write3.message, write3.dataStream);
        expect(writeReply1.status.code).to.equal(202);
        expect(writeReply2.status.code).to.equal(202);
        expect(writeReply3.status.code).to.equal(202);

        // testing range using gt & lt
        const recordsQuery1 = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { dataSize: { gt: 10, lt: 60 } },
        });
        const reply1 = await dwn.processMessage(alice.did, recordsQuery1.message);
        expect(reply1.entries?.length).to.equal(1);
        expect(reply1.entries![0].recordId).to.equal(write2.message.recordId);

        // testing range using gte & lt
        const recordsQuery2 = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { dataSize: { gte: 10, lt: 60 } },
        });
        const reply2 = await dwn.processMessage(alice.did, recordsQuery2.message);
        expect(reply2.entries?.length).to.equal(2);
        const reply2RecordIds = reply2.entries?.map(e => e.recordId);
        expect(reply2RecordIds).to.have.members([ write1.message.recordId, write2.message.recordId ]);

        // testing range using gt & lte
        const recordsQuery3 = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { dataSize: { gt: 50, lte: 100 } },
        });
        const reply3 = await dwn.processMessage(alice.did, recordsQuery3.message);
        expect(reply3.entries?.length).to.equal(1);
        expect(reply3.entries![0].recordId).to.equal(write3.message.recordId);

        // testing range using gte & lte
        const recordsQuery4 = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { dataSize: { gte: 10, lte: 100 } },
        });
        const reply4 = await dwn.processMessage(alice.did, recordsQuery4.message);
        expect(reply4.entries?.length).to.equal(3);
        const reply4RecordIds = reply4.entries?.map(e => e.recordId);
        expect(reply4RecordIds).to.have.members([ write1.message.recordId, write2.message.recordId, write3.message.recordId ]);
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
          dateSort : DateSort.CreatedAscending
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
          dateSort : DateSort.CreatedAscending
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
          dateSort : DateSort.CreatedAscending
        });
        const reply3 = await dwn.processMessage(alice.did, recordsQuery3.message);
        expect(reply3.entries?.length).to.equal(1);
        expect(reply3.entries![0].encodedData).to.equal(Encoder.bytesToBase64Url(write3.dataBytes!));

        // testing edge case where value equals `from` and `to`
        const recordsQuery4 = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          filter   : { dateCreated: { from: firstDayOf2022, to: firstDayOf2023 } },
          dateSort : DateSort.CreatedAscending
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
          dateSort: DateSort.CreatedAscending
        });
        const reply = await dwn.processMessage(alice.did, recordsQuery5.message);
        expect(reply.entries?.length).to.equal(1);
        expect(reply.entries![0].encodedData).to.equal(Encoder.bytesToBase64Url(write2.dataBytes!));
      });

      it('should include `authorization` in returned records', async () => {
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
        expect((queryReply.entries![0] as any).authorization).to.deep.equal(message.authorization);
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
      // setup: 2 records in DWN: 1 published and 1 unpublished
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
          dateSort : DateSort.PublishedAscending,
          filter   : { schema }
        });
        const publishedAscendingQueryReply = await dwn.processMessage(alice.did, publishedAscendingQueryData.message);

        expect(publishedAscendingQueryReply.entries?.length).to.equal(1);
        expect(publishedAscendingQueryReply.entries![0].descriptor['datePublished']).to.equal(publishedWriteData.message.descriptor.datePublished);

        // test published date scending sort does not include any records that is not published
        const publishedDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          dateSort : DateSort.PublishedDescending,
          filter   : { schema }
        });
        const publishedDescendingQueryReply = await dwn.processMessage(alice.did, publishedDescendingQueryData.message);

        expect(publishedDescendingQueryReply.entries?.length).to.equal(1);
        expect(publishedDescendingQueryReply.entries![0].descriptor['datePublished']).to.equal(publishedWriteData.message.descriptor.datePublished);
      });

      it('should sort records if `dateSort` is specified', async () => {
      // insert three messages into DB
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
          dateSort : DateSort.CreatedAscending,
          filter   : { schema }
        });
        const createdAscendingQueryReply = await dwn.processMessage(alice.did, createdAscendingQueryData.message);

        expect(createdAscendingQueryReply.entries?.[0].descriptor['dateCreated']).to.equal(write1Data.message.descriptor.dateCreated);
        expect(createdAscendingQueryReply.entries?.[1].descriptor['dateCreated']).to.equal(write2Data.message.descriptor.dateCreated);
        expect(createdAscendingQueryReply.entries?.[2].descriptor['dateCreated']).to.equal(write3Data.message.descriptor.dateCreated);

        // createdDescending test
        const createdDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          dateSort : DateSort.CreatedDescending,
          filter   : { schema }
        });
        const createdDescendingQueryReply = await dwn.processMessage(alice.did, createdDescendingQueryData.message);

        expect(createdDescendingQueryReply.entries?.[0].descriptor['dateCreated']).to.equal(write3Data.message.descriptor.dateCreated);
        expect(createdDescendingQueryReply.entries?.[1].descriptor['dateCreated']).to.equal(write2Data.message.descriptor.dateCreated);
        expect(createdDescendingQueryReply.entries?.[2].descriptor['dateCreated']).to.equal(write1Data.message.descriptor.dateCreated);

        // publishedAscending test
        const publishedAscendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          dateSort : DateSort.PublishedAscending,
          filter   : { schema }
        });
        const publishedAscendingQueryReply = await dwn.processMessage(alice.did, publishedAscendingQueryData.message);

        expect(publishedAscendingQueryReply.entries?.[0].descriptor['datePublished']).to.equal(write1Data.message.descriptor.datePublished);
        expect(publishedAscendingQueryReply.entries?.[1].descriptor['datePublished']).to.equal(write2Data.message.descriptor.datePublished);
        expect(publishedAscendingQueryReply.entries?.[2].descriptor['datePublished']).to.equal(write3Data.message.descriptor.datePublished);

        // publishedDescending test
        const publishedDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          dateSort : DateSort.PublishedDescending,
          filter   : { schema }
        });
        const publishedDescendingQueryReply = await dwn.processMessage(alice.did, publishedDescendingQueryData.message);

        expect(publishedDescendingQueryReply.entries?.[0].descriptor['datePublished']).to.equal(write3Data.message.descriptor.datePublished);
        expect(publishedDescendingQueryReply.entries?.[1].descriptor['datePublished']).to.equal(write2Data.message.descriptor.datePublished);
        expect(publishedDescendingQueryReply.entries?.[2].descriptor['datePublished']).to.equal(write1Data.message.descriptor.datePublished);
      });

      it('should tiebreak using `messageCid` when sorting encounters identical values', async () => {
        // setup: 3 messages with the same `dateCreated` value
        const dateCreated = createDateString(new Date());
        const messageTimestamp = dateCreated;
        const alice = await DidKeyResolver.generate();
        const schema = 'aSchema';
        const published = true;
        const write1Data = await TestDataGenerator.generateRecordsWrite({ messageTimestamp, dateCreated, author: alice, schema, published });
        const write2Data = await TestDataGenerator.generateRecordsWrite({ messageTimestamp, dateCreated, author: alice, schema, published });
        const write3Data = await TestDataGenerator.generateRecordsWrite({ messageTimestamp, dateCreated, author: alice, schema, published });

        // sort the messages in lexicographical order against `messageCid`
        const [ oldestWrite, middleWrite, newestWrite ] = await ArrayUtility.asyncSort(
          [ write1Data, write2Data, write3Data ],
          (messageDataA, messageDataB) => { return Message.compareCid(messageDataA.message, messageDataB.message); }
        );

        // intentionally write the RecordsWrite of out lexicographical order to avoid the test query below accidentally having the correct order
        const reply2 = await dwn.processMessage(alice.did, middleWrite.message, middleWrite.dataStream);
        expect(reply2.status.code).to.equal(202);
        const reply3 = await dwn.processMessage(alice.did, newestWrite.message, newestWrite.dataStream);
        expect(reply3.status.code).to.equal(202);
        const reply1 = await dwn.processMessage(alice.did, oldestWrite.message, oldestWrite.dataStream);
        expect(reply1.status.code).to.equal(202);

        const queryMessageData = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          filter   : { schema },
          dateSort : DateSort.CreatedAscending
        });
        const queryReply = await dwn.processMessage(alice.did, queryMessageData.message);

        // verify that messages returned are sorted/tiebreak by `messageCid`
        expect(queryReply.status.code).to.equal(200);
        expect(queryReply.entries?.length).to.equal(3);
        expect((queryReply.entries![0] as RecordsWriteMessage).recordId).to.equal(oldestWrite.message.recordId);
        expect((queryReply.entries![1] as RecordsWriteMessage).recordId).to.equal(middleWrite.message.recordId);
        expect((queryReply.entries![2] as RecordsWriteMessage).recordId).to.equal(newestWrite.message.recordId);
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
        const results: RecordsQueryReplyEntry[] = [];
        let messageCid;
        while (true) {
          const pageQuery = await TestDataGenerator.generateRecordsQuery({
            author : alice,
            filter : {
              schema: 'https://schema'
            },
            pagination: {
              limit: limit,
              messageCid,
            },
          });

          const pageReply = await dwn.processMessage(alice.did, pageQuery.message);
          expect(pageReply.status.code).to.equal(200);
          messageCid = pageReply.paginationMessageCid;
          expect(pageReply.entries?.length).to.be.lte(limit);
          results.push(...pageReply.entries!);
          if (messageCid === undefined) {
            break;
          }
        }
        expect(results.length).to.equal(messages.length);
        expect(messages.every(({ message }) => results.map(e => (e as RecordsWriteMessage).recordId).includes(message.recordId)));
      });

      it('paginationMessageCid should match the messageCid of the last entry in the returned query', async () => {
        const alice = await DidKeyResolver.generate();

        const messages = await Promise.all(Array(6).fill({}).map(_ => TestDataGenerator.generateRecordsWrite({
          author : alice,
          schema : 'https://schema'
        })));
        for (const message of messages) {
          const result = await dwn.processMessage(alice.did, message.message, message.dataStream);
          expect(result.status.code).to.equal(202);
        }

        const limit = 5;
        const pageQuery = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            schema: 'https://schema'
          },
          pagination: {
            limit: limit,
          },
        });

        const pageReply = await dwn.processMessage(alice.did, pageQuery.message);
        expect(pageReply.status.code).to.equal(200);
        expect(pageReply.entries?.length).to.be.lte(limit);
        expect(pageReply.paginationMessageCid).to.exist;
        const lastMessageWithAuthorization = messages.find(m => m.message.recordId === pageReply.entries?.at(-1)!.recordId)!;
        const messageCid = await Message.getCid(lastMessageWithAuthorization.message);
        expect(pageReply.paginationMessageCid).to.equal(messageCid);
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
      // 5th is published, authored by Alice and is meant for Carol as recipient;

        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();
        const carol = await DidKeyResolver.generate();

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
        const record5Data = await TestDataGenerator.generateRecordsWrite(
          { author: alice, schema, data: Encoder.stringToBytes('5'), published: true, recipient: carol.did }
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

        const additionalIndexes5 = await constructRecordsWriteIndexes(record5Data.recordsWrite, true);
        record5Data.message = await recordsWriteHandler.processEncodedData(record5Data.message, record5Data.dataStream);
        await messageStore.put(alice.did, record5Data.message, additionalIndexes5);
        await eventLog.append(alice.did, await Message.getCid(record5Data.message));

        // test correctness for Bob's query
        const bobQueryMessageData = await TestDataGenerator.generateRecordsQuery({
          author : bob,
          filter : { schema }
        });

        const replyToBob = await dwn.processMessage(alice.did, bobQueryMessageData.message);

        expect(replyToBob.status.code).to.equal(200);
        expect(replyToBob.entries?.length).to.equal(4); // expect 4 records

        const privateRecordsForBob = replyToBob.entries?.filter(message => message.encodedData === Encoder.stringToBase64Url('2'))!;
        const privateRecordsFromBob = replyToBob.entries?.filter(message => message.encodedData === Encoder.stringToBase64Url('3'))!;
        const publicRecords = replyToBob.entries?.filter(message => message.encodedData === Encoder.stringToBase64Url('4') || message.encodedData === Encoder.stringToBase64Url('5'))!;
        expect(privateRecordsForBob.length).to.equal(1);
        expect(privateRecordsFromBob.length).to.equal(1);
        expect(publicRecords.length).to.equal(2);

        // test correctness for Alice's query
        const aliceQueryMessageData = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { schema }
        });

        const replyToAliceQuery = await dwn.processMessage(alice.did, aliceQueryMessageData.message);

        expect(replyToAliceQuery.status.code).to.equal(200);
        expect(replyToAliceQuery.entries?.length).to.equal(5); // expect all 5 records

        // filter for public records with carol as recipient
        const bobQueryCarolMessageData = await TestDataGenerator.generateRecordsQuery({
          author : bob,
          filter : { schema, recipient: carol.did }
        });
        const replyToBobCarolQuery = await dwn.processMessage(alice.did, bobQueryCarolMessageData.message);
        expect(replyToBobCarolQuery.status.code).to.equal(200);
        expect(replyToBobCarolQuery.entries?.length).to.equal(1);
        expect(replyToBobCarolQuery.entries![0]!.encodedData).to.equal(Encoder.stringToBase64Url('5'));
      });

      it('should paginate correctly for fetchRecordsAsNonOwner()', async () => {
        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();
        const schema = 'schema1';

        // published messages bob
        const bobPublishedPromise = Array(5).fill({}).map(_ => TestDataGenerator.generateRecordsWrite({
          author: bob, schema, data: TestDataGenerator.randomBytes(10), published: true,
        }));

        // published messages alice
        const alicePublishedPromise = Array(5).fill({}).map(_ => TestDataGenerator.generateRecordsWrite({
          author: alice, schema, data: TestDataGenerator.randomBytes(10), published: true,
        }));

        // alice non public messages
        const aliceMessagesPromise = Array(5).fill({}).map(_ => TestDataGenerator.generateRecordsWrite({
          author: alice, schema, data: TestDataGenerator.randomBytes(10)
        }));

        // bob non public messages
        const bobMessagesPromise = Array(5).fill({}).map(_ => TestDataGenerator.generateRecordsWrite({
          author: bob, schema, data: TestDataGenerator.randomBytes(10)
        }));

        // non public messages intended for bob
        const aliceMessagesForBobPromise = Array(5).fill({}).map(_ => TestDataGenerator.generateRecordsWrite({
          author: alice, schema, data: TestDataGenerator.randomBytes(10), recipient: bob.did,
        }));

        const messagePromises = [
          ...bobPublishedPromise,
          ...aliceMessagesPromise,
          ...bobMessagesPromise,
          ...alicePublishedPromise,
          ...aliceMessagesForBobPromise,
        ];

        const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog);

        const messages: GenericMessage[] = [];
        for await (const { recordsWrite, message, dataStream } of messagePromises) {
          const indexes = await constructRecordsWriteIndexes(recordsWrite, true);
          const processedMessage = await recordsWriteHandler.processEncodedData(message, dataStream);
          await messageStore.put(alice.did, processedMessage, indexes);
          await eventLog.append(alice.did, await Message.getCid(processedMessage));
          messages.push(processedMessage);
        }


        // fetch all from alice for sanity, alice should get all of the records
        // page1 alice
        const aliceQueryMessageDataPage1 = await TestDataGenerator.generateRecordsQuery({
          author     : alice,
          filter     : { schema },
          dateSort   : DateSort.CreatedAscending,
          pagination : { limit: 10 },
        });

        const sortedMessages = await MessageStoreLevel.sortMessages(messages, { dateCreated: SortOrder.Ascending });
        let results = await dwn.processMessage(alice.did, aliceQueryMessageDataPage1.message) ;
        expect(results.status.code).to.equal(200);
        expect(results.entries?.length).to.equal(10, 'alice page 1');
        const page1PaginationLastMessage = await Message.getCid(sortedMessages.at(9)!); // get messageCid from message with authorization.
        expect(results.paginationMessageCid).to.equal(page1PaginationLastMessage, 'alice page 1');

        // page2 alice
        const aliceQueryMessageDataPage2 = await TestDataGenerator.generateRecordsQuery({
          author     : alice,
          filter     : { schema },
          dateSort   : DateSort.CreatedAscending,
          pagination : { limit: 10, messageCid: results.paginationMessageCid },
        });
        results = await dwn.processMessage(alice.did, aliceQueryMessageDataPage2.message) ;
        expect(results.status.code).to.equal(200);
        expect(results.entries?.length).to.equal(10, 'alice page 2');
        const page2PaginationLastMessage = await Message.getCid(sortedMessages.at(19)!); // get messageCid from message with authorization.
        expect(results.paginationMessageCid).to.equal(page2PaginationLastMessage, 'alice page 2');

        // page3 alice
        const aliceQueryMessageDataPage3 = await TestDataGenerator.generateRecordsQuery({
          author     : alice,
          filter     : { schema },
          dateSort   : DateSort.CreatedAscending,
          pagination : { limit: 10, messageCid: results.paginationMessageCid },
        });
        results = await dwn.processMessage(alice.did, aliceQueryMessageDataPage3.message) ;
        expect(results.status.code).to.equal(200);
        expect(results.entries?.length).to.equal(5, 'alice page 3');
        expect(results.paginationMessageCid).to.not.exist;

        const bobs = (m: RecordsWriteMessage): boolean => {
          return m.descriptor.recipient === bob.did || m.descriptor.published === true || Message.getSigner(m) === bob.did;
        };

        // all records from alice have been validated
        // now we prepare to test records that only bob should get

        const bobSorted = sortedMessages.filter(m => bobs(m as RecordsWriteMessage));
        const bobRetrieved: GenericMessage[] = [];

        const bobQueryMessagePage1 = await TestDataGenerator.generateRecordsQuery({
          author     : bob,
          filter     : { schema },
          dateSort   : DateSort.CreatedAscending,
          pagination : { limit: 10 },
        });
        results = await dwn.processMessage(alice.did, bobQueryMessagePage1.message) ;
        expect(results.status.code).to.equal(200);
        expect(results.entries?.length).to.equal(10, 'bob page 1');
        const page1BobPaginationLastMessage = await Message.getCid(bobSorted.at(9)!);
        expect(results.paginationMessageCid).to.equal(page1BobPaginationLastMessage, 'bob page 1');
        bobRetrieved.push(...results.entries!);

        const bobQueryMessagePage2 = await TestDataGenerator.generateRecordsQuery({
          author     : bob,
          filter     : { schema },
          dateSort   : DateSort.CreatedAscending,
          pagination : { limit: 10, messageCid: results.paginationMessageCid },
        });
        results = await dwn.processMessage(alice.did, bobQueryMessagePage2.message) ;
        expect(results.status.code).to.equal(200);
        expect(results.entries?.length).to.equal(10, 'bob page 2');
        expect(results.paginationMessageCid).to.not.exist;
        bobRetrieved.push(...results.entries!);

        const compareRecordId = (a: GenericMessage, b:GenericMessage): boolean => {
          return (a as RecordsWriteMessage).recordId === (b as RecordsWriteMessage).recordId;
        };

        expect(bobSorted.every((m, i) => compareRecordId(bobRetrieved.at(i)!, m)));
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
        recordsQuery.message.authorization = await Message.createAuthorizationAsAuthor(
          recordsQuery.message.descriptor,
          Jws.createSigner(alice)
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
        recordsQuery.message.authorization = await Message.createAuthorizationAsAuthor(
          recordsQuery.message.descriptor,
          Jws.createSigner(alice)
        );

        // Send records write message
        const reply = await dwn.processMessage(alice.did, recordsQuery.message);
        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain(DwnErrorCode.UrlSchemaNotNormalized);
      });

      describe('protocol based queries', () => {
        it('does not try protocol authorization if protocolRole is not invoked', async () => {
          // scenario: Alice creates a thread and writes some chat messages writes a chat message. Alice addresses
          //           only one chat message to Bob. Bob queries by protocol URI without invoking a protocolRole,
          //           and he is able to receive the message addressed to him.

          const alice = await DidKeyResolver.generate();
          const bob = await DidKeyResolver.generate();

          const protocolDefinition = threadRoleProtocolDefinition;

          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolWriteReply.status.code).to.equal(202);

          // Alice writes a 'thread' record
          const threadRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'thread',
          });
          const threadRoleReply = await dwn.processMessage(alice.did, threadRecord.message, threadRecord.dataStream);
          expect(threadRoleReply.status.code).to.equal(202);

          // Alice writes one 'chat' record addressed to Bob
          const chatRecordForBob = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : bob.did,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'thread/chat',
            published    : false,
            contextId    : threadRecord.message.contextId,
            parentId     : threadRecord.message.recordId,
            data         : new TextEncoder().encode('Bob can read this cuz he is my friend'),
          });
          const chatRecordForBobReply = await dwn.processMessage(alice.did, chatRecordForBob.message, chatRecordForBob.dataStream);
          expect(chatRecordForBobReply.status.code).to.equal(202);

          // Alice writes two 'chat' records NOT addressed to Bob
          for (let i = 0; i < 2; i++) {
            const chatRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : alice.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'thread/chat',
              published    : false,
              contextId    : threadRecord.message.contextId,
              parentId     : threadRecord.message.recordId,
              data         : new TextEncoder().encode('Bob cannot read this'),
            });
            const chatReply = await dwn.processMessage(alice.did, chatRecord.message, chatRecord.dataStream);
            expect(chatReply.status.code).to.equal(202);
          }

          // Bob queries without invoking any protocolRole
          const chatQuery = await TestDataGenerator.generateRecordsQuery({
            author : bob,
            filter : {
              protocol: protocolDefinition.protocol,
            },
          });
          const chatQueryReply = await dwn.processMessage(alice.did, chatQuery.message) as RecordsQueryReply;
          expect(chatQueryReply.status.code).to.equal(200);
          expect(chatQueryReply.entries?.length).to.equal(1);
          expect(chatQueryReply.entries![0].recordId).to.eq(chatRecordForBob.message.recordId);
        });

        it('allows $globalRole authorized queries', async () => {
          // scenario: Alice creates a thread and writes some chat messages writes a chat message. Bob invokes his
          //           thread member role in order to query the chat messages.

          const alice = await DidKeyResolver.generate();
          const bob = await DidKeyResolver.generate();

          const protocolDefinition = friendRoleProtocolDefinition;

          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolWriteReply.status.code).to.equal(202);

          // Alice writes a 'friend' $globalRole record with Bob as recipient
          const friendRoleRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : bob.did,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'friend',
            data         : new TextEncoder().encode('Bob is my friend'),
          });
          const friendRoleReply = await dwn.processMessage(alice.did, friendRoleRecord.message, friendRoleRecord.dataStream);
          expect(friendRoleReply.status.code).to.equal(202);

          // Alice writes three 'chat' records
          const chatRecordIds = [];
          for (let i = 0; i < 3; i++) {
            const chatRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : alice.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'chat',
              published    : false,
              data         : new TextEncoder().encode('Bob can read this cuz he is my friend'),
            });
            const chatReply = await dwn.processMessage(alice.did, chatRecord.message, chatRecord.dataStream);
            expect(chatReply.status.code).to.equal(202);
            chatRecordIds.push(chatRecord.message.recordId);
          }

          // Bob invokes his friendRole to query that records
          const chatQuery = await TestDataGenerator.generateRecordsQuery({
            author : bob,
            filter : {
              protocol     : protocolDefinition.protocol,
              protocolPath : 'chat',
            },
            protocolRole: 'friend',
          });
          const chatQueryReply = await dwn.processMessage(alice.did, chatQuery.message) as RecordsQueryReply;
          expect(chatQueryReply.status.code).to.equal(200);
          expect(chatQueryReply.entries?.length).to.equal(3);
          expect(chatQueryReply.entries!.map((record) => record.recordId)).to.have.all.members(chatRecordIds);
        });

        it('allows $contextRole authorized queries', async () => {
          // scenario: Alice writes some chat messages writes a chat message. Bob invokes his
          //           friend role in order to query the chat message.

          const alice = await DidKeyResolver.generate();
          const bob = await DidKeyResolver.generate();

          const protocolDefinition = threadRoleProtocolDefinition;

          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolWriteReply.status.code).to.equal(202);

          // Alice writes a 'thread' record
          const threadRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'thread',
          });
          const threadRoleReply = await dwn.processMessage(alice.did, threadRecord.message, threadRecord.dataStream);
          expect(threadRoleReply.status.code).to.equal(202);

          // Alice writes a 'participant' $contextRole record with Bob as recipient
          const participantRoleRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : bob.did,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'thread/participant',
            contextId    : threadRecord.message.contextId,
            parentId     : threadRecord.message.recordId,
            data         : new TextEncoder().encode('Bob is my friend'),
          });
          const participantRoleReply = await dwn.processMessage(alice.did, participantRoleRecord.message, participantRoleRecord.dataStream);
          expect(participantRoleReply.status.code).to.equal(202);

          // Alice writes three 'chat' records
          const chatRecordIds = [];
          for (let i = 0; i < 3; i++) {
            const chatRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : alice.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'thread/chat',
              published    : false,
              contextId    : threadRecord.message.contextId,
              parentId     : threadRecord.message.recordId,
              data         : new TextEncoder().encode('Bob can read this cuz he is my friend'),
            });
            const chatReply = await dwn.processMessage(alice.did, chatRecord.message, chatRecord.dataStream);
            expect(chatReply.status.code).to.equal(202);
            chatRecordIds.push(chatRecord.message.recordId);
          }

          // Bob invokes his friendRole to query that records
          const chatQuery = await TestDataGenerator.generateRecordsQuery({
            author : bob,
            filter : {
              protocol     : protocolDefinition.protocol,
              protocolPath : 'thread/chat',
              contextId    : threadRecord.message.contextId,
            },
            protocolRole: 'thread/participant',
          });
          const chatQueryReply = await dwn.processMessage(alice.did, chatQuery.message) as RecordsQueryReply;
          expect(chatQueryReply.status.code).to.equal(200);
          expect(chatQueryReply.entries?.length).to.equal(3);
          expect(chatQueryReply.entries!.map((record) => record.recordId)).to.have.all.members(chatRecordIds);
        });

        it('does not execute protocol queries where protocolPath is missing from the filter', async () => {
          // scenario: Alice writes some chat messages. Bob invokes his $globalRole to query those messages,
          //           but his query filter does not include protocolPath.

          const alice = await DidKeyResolver.generate();
          const bob = await DidKeyResolver.generate();

          const protocolDefinition = friendRoleProtocolDefinition;

          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolWriteReply.status.code).to.equal(202);

          // Alice writes a 'friend' $globalRole record with Bob as recipient
          const friendRoleRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : bob.did,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'friend',
            data         : new TextEncoder().encode('Bob is my friend'),
          });
          const friendRoleReply = await dwn.processMessage(alice.did, friendRoleRecord.message, friendRoleRecord.dataStream);
          expect(friendRoleReply.status.code).to.equal(202);

          // Alice writes three 'chat' records
          const chatRecordIds = [];
          for (let i = 0; i < 3; i++) {
            const chatRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : alice.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'chat',
              published    : false,
              data         : new TextEncoder().encode('Bob can read this cuz he is my friend'),
            });
            const chatReply = await dwn.processMessage(alice.did, chatRecord.message, chatRecord.dataStream);
            expect(chatReply.status.code).to.equal(202);
            chatRecordIds.push(chatRecord.message.recordId);
          }

          // Bob invokes his friendRole to query but does not have `protocolPath` in the filter
          const chatQuery = await TestDataGenerator.generateRecordsQuery({
            author : bob,
            filter : {
              protocol: protocolDefinition.protocol,
              // protocolPath deliberately omitted
            },
            protocolRole: 'friend',
          });
          const chatQueryReply = await dwn.processMessage(alice.did, chatQuery.message) as RecordsQueryReply;
          expect(chatQueryReply.status.code).to.equal(400);
          expect(chatQueryReply.status.detail).to.contain(DwnErrorCode.RecordsQueryFilterMissingRequiredProperties);
        });

        it('does not execute $contextRole authorized queries where contextId is missing from the filter', async () => {
          // scenario: Alice writes some chat messages and gives Bob a role allowing him to access them. But Bob's filter
          //           does not contain a contextId so the query fails.
          const alice = await DidKeyResolver.generate();
          const bob = await DidKeyResolver.generate();

          const protocolDefinition = threadRoleProtocolDefinition;

          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolWriteReply.status.code).to.equal(202);

          // Alice writes a 'thread' record
          const threadRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'thread',
          });
          const threadRoleReply = await dwn.processMessage(alice.did, threadRecord.message, threadRecord.dataStream);
          expect(threadRoleReply.status.code).to.equal(202);

          // Alice writes a 'friend' $globalRole record with Bob as recipient
          const participantRoleRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : bob.did,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'thread/participant',
            contextId    : threadRecord.message.contextId,
            parentId     : threadRecord.message.recordId,
            data         : new TextEncoder().encode('Bob is my friend'),
          });
          const participantRoleReply = await dwn.processMessage(alice.did, participantRoleRecord.message, participantRoleRecord.dataStream);
          expect(participantRoleReply.status.code).to.equal(202);

          // Alice writes three 'chat' records
          const chatRecordIds = [];
          for (let i = 0; i < 3; i++) {
            const chatRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : alice.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'thread/chat',
              published    : false,
              contextId    : threadRecord.message.contextId,
              parentId     : threadRecord.message.recordId,
              data         : new TextEncoder().encode('Bob can read this cuz he is my friend'),
            });
            const chatReply = await dwn.processMessage(alice.did, chatRecord.message, chatRecord.dataStream);
            expect(chatReply.status.code).to.equal(202);
            chatRecordIds.push(chatRecord.message.recordId);
          }

          // Bob invokes his thread participant role to query
          const chatQuery = await TestDataGenerator.generateRecordsQuery({
            author : bob,
            filter : {
              protocol     : protocolDefinition.protocol,
              protocolPath : 'thread/chat',
              // contextId deliberately omitted
            },
            protocolRole: 'thread/participant',
          });
          const chatQueryReply = await dwn.processMessage(alice.did, chatQuery.message) as RecordsQueryReply;
          expect(chatQueryReply.status.code).to.eq(401);
          expect(chatQueryReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationMissingContextId);
        });

        it('rejects $globalRole authorized queries if the query author does not have a matching $globalRole', async () => {
          // scenario: Alice creates a thread and writes some chat messages writes a chat message. Bob invokes a
          //           $globalRole but fails because he does not actually have a role.

          const alice = await DidKeyResolver.generate();
          const bob = await DidKeyResolver.generate();

          const protocolDefinition = friendRoleProtocolDefinition;

          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolWriteReply.status.code).to.equal(202);

          // Alice writes three 'chat' records
          const chatRecordIds = [];
          for (let i = 0; i < 3; i++) {
            const chatRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : alice.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'chat',
              published    : false,
              data         : new TextEncoder().encode('Bob can read this cuz he is my friend'),
            });
            const chatReply = await dwn.processMessage(alice.did, chatRecord.message, chatRecord.dataStream);
            expect(chatReply.status.code).to.equal(202);
            chatRecordIds.push(chatRecord.message.recordId);
          }

          // Bob invokes his friendRole to query that records
          const chatQuery = await TestDataGenerator.generateRecordsQuery({
            author : bob,
            filter : {
              protocol     : protocolDefinition.protocol,
              protocolPath : 'chat',
            },
            protocolRole: 'friend',
          });
          const chatQueryReply = await dwn.processMessage(alice.did, chatQuery.message) as RecordsQueryReply;
          expect(chatQueryReply.status.code).to.eq(401);
          expect(chatQueryReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationMissingRole);
        });

        it('rejects $contextRole authorized queries where the query author does not have a matching $contextRole', async () => {

          const alice = await DidKeyResolver.generate();
          const bob = await DidKeyResolver.generate();

          const protocolDefinition = threadRoleProtocolDefinition;

          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolWriteReply.status.code).to.equal(202);

          // Alice writes a 'thread' record
          const threadRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'thread',
          });
          const threadRoleReply = await dwn.processMessage(alice.did, threadRecord.message, threadRecord.dataStream);
          expect(threadRoleReply.status.code).to.equal(202);

          // Alice writes three 'chat' records
          const chatRecordIds = [];
          for (let i = 0; i < 3; i++) {
            const chatRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : alice.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'thread/chat',
              published    : false,
              contextId    : threadRecord.message.contextId,
              parentId     : threadRecord.message.recordId,
              data         : new TextEncoder().encode('Bob can read this cuz he is my friend'),
            });
            const chatReply = await dwn.processMessage(alice.did, chatRecord.message, chatRecord.dataStream);
            expect(chatReply.status.code).to.equal(202);
            chatRecordIds.push(chatRecord.message.recordId);
          }

          // Bob invokes his friendRole to query that records
          const chatQuery = await TestDataGenerator.generateRecordsQuery({
            author : bob,
            filter : {
              protocol     : protocolDefinition.protocol,
              protocolPath : 'thread/chat',
              contextId    : threadRecord.message.contextId,
            },
            protocolRole: 'thread/participant',
          });
          const chatQueryReply = await dwn.processMessage(alice.did, chatQuery.message) as RecordsQueryReply;
          expect(chatQueryReply.status.code).to.eq(401);
          expect(chatQueryReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationMissingRole);
        });
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