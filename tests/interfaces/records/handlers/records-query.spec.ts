import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DidKeyResolver } from '../../../../src/did/did-key-resolver.js';
import { Encoder } from '../../../../src/utils/encoder.js';
import { handleRecordsQuery } from '../../../../src/interfaces/records/handlers/records-query.js';
import { Jws } from '../../../../src/utils/jws.js';
import { MessageStoreLevel } from '../../../../src/store/message-store-level.js';
import { Temporal } from '@js-temporal/polyfill';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import { TestStubGenerator } from '../../../utils/test-stub-generator.js';

import { constructRecordsWriteIndexes, handleRecordsWrite } from '../../../../src/interfaces/records/handlers/records-write.js';
import { DateSort, RecordsQuery } from '../../../../src/interfaces/records/messages/records-query.js';
import { DidResolver, RecordsWriteMessage } from '../../../../src/index.js';

chai.use(chaiAsPromised);

describe('handleRecordsQuery()', () => {
  describe('functional tests', () => {
    let didResolver: DidResolver;
    let messageStore: MessageStoreLevel;

    before(async () => {
      // important to follow this pattern to initialize the message store in tests
      // so that different suites can reuse the same block store and index location for testing
      messageStore = new MessageStoreLevel({
        blockstoreLocation : 'TEST-BLOCKSTORE',
        indexLocation      : 'TEST-INDEX'
      });

      await messageStore.open();

      didResolver = new DidResolver([new DidKeyResolver()]);
    });

    beforeEach(async () => {
      sinon.restore(); // wipe all previous stubs/spies/mocks/fakes
      await messageStore.clear(); // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
    });

    after(async () => {
      await messageStore.close();
    });

    it('should return records matching the query', async () => {
      // insert three messages into DB, two with matching protocol
      const alice = await TestDataGenerator.generatePersona();
      const dataFormat = 'myAwesomeDataFormat';
      const write1Data = await TestDataGenerator.generateRecordsWrite({ requester: alice });
      const write2Data = await TestDataGenerator.generateRecordsWrite({ requester: alice, dataFormat, schema: 'schema1' });
      const write3Data = await TestDataGenerator.generateRecordsWrite({ requester: alice, dataFormat, schema: 'schema2' });

      // setting up a stub method resolver
      const didResolverStub = TestStubGenerator.createDidResolverStub(alice);

      // insert data
      const writeReply1 = await handleRecordsWrite(alice.did, write1Data.message, messageStore, didResolverStub);
      const writeReply2 = await handleRecordsWrite(alice.did, write2Data.message, messageStore, didResolverStub);
      const writeReply3 = await handleRecordsWrite(alice.did, write3Data.message, messageStore, didResolverStub);
      expect(writeReply1.status.code).to.equal(202);
      expect(writeReply2.status.code).to.equal(202);
      expect(writeReply3.status.code).to.equal(202);

      // testing singular conditional query
      const messageData = await TestDataGenerator.generateRecordsQuery({ requester: alice, filter: { dataFormat } });

      const reply = await handleRecordsQuery(alice.did, messageData.message, messageStore, didResolverStub);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(2); // only 2 entries should match the query on protocol

      // testing multi-conditional query, reuse data generated above for bob
      const messageData2 = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : {
          dataFormat,
          schema: 'schema1'
        }
      });

      const reply2 = await handleRecordsQuery(alice.did, messageData2.message, messageStore, didResolverStub);

      expect(reply2.status.code).to.equal(200);
      expect(reply2.entries?.length).to.equal(1); // only 1 entry should match the query
    });

    it('should be able to query by attester', async () => {
      // scenario: 2 records authored by alice, 1st attested by alice, 2nd attested by bob
      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();
      const recordsWrite1 = await TestDataGenerator.generateRecordsWrite({ requester: alice, attesters: [alice] });
      const recordsWrite2 = await TestDataGenerator.generateRecordsWrite({ requester: alice, attesters: [bob] });

      // insert data
      const writeReply1 = await handleRecordsWrite(alice.did, recordsWrite1.message, messageStore, didResolver);
      const writeReply2 = await handleRecordsWrite(alice.did, recordsWrite2.message, messageStore, didResolver);
      expect(writeReply1.status.code).to.equal(202);
      expect(writeReply2.status.code).to.equal(202);

      // testing attester filter
      const recordsQuery1 = await TestDataGenerator.generateRecordsQuery({ requester: alice, filter: { attester: alice.did } });
      const reply1 = await handleRecordsQuery(alice.did, recordsQuery1.message, messageStore, didResolver);
      expect(reply1.entries?.length).to.equal(1);
      const reply1Attester = Jws.getSignerDid((reply1.entries[0] as RecordsWriteMessage).attestation.signatures[0]);
      expect(reply1Attester).to.equal(alice.did);

      // testing attester + another filter
      const recordsQuery2 = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { attester: bob.did, schema: recordsWrite2.message.descriptor.schema }
      });
      const reply2 = await handleRecordsQuery(alice.did, recordsQuery2.message, messageStore, didResolver);
      expect(reply2.entries?.length).to.equal(1);
      const reply2Attester = Jws.getSignerDid((reply2.entries[0] as RecordsWriteMessage).attestation.signatures[0]);
      expect(reply2Attester).to.equal(bob.did);

      // testing attester filter that yields no results
      const carol = await DidKeyResolver.generate();
      const recordsQuery3 = await TestDataGenerator.generateRecordsQuery({ requester: alice, filter: { attester: carol.did } });
      const reply3 = await handleRecordsQuery(alice.did, recordsQuery3.message, messageStore, didResolver);
      expect(reply3.entries?.length).to.equal(0);
    });

    it('should be able to range query by `dateCreated`', async () => {
      // scenario: 3 records authored by alice, created on first of 2021, 2022, and 2023 respectively, only the first 2 records share the same schema
      const firstDayOf2021 = Temporal.PlainDateTime.from({ year: 2021, month: 1, day: 1 }).toString({ smallestUnit: 'microseconds' });
      const firstDayOf2022 = Temporal.PlainDateTime.from({ year: 2022, month: 1, day: 1 }).toString({ smallestUnit: 'microseconds' });
      const firstDayOf2023 = Temporal.PlainDateTime.from({ year: 2023, month: 1, day: 1 }).toString({ smallestUnit: 'microseconds' });
      const alice = await DidKeyResolver.generate();
      const write1 = await TestDataGenerator.generateRecordsWrite({ requester: alice, dateCreated: firstDayOf2021, dateModified: firstDayOf2021 });
      const write2 = await TestDataGenerator.generateRecordsWrite({ requester: alice, dateCreated: firstDayOf2022, dateModified: firstDayOf2022 });
      const write3 = await TestDataGenerator.generateRecordsWrite({ requester: alice, dateCreated: firstDayOf2023, dateModified: firstDayOf2023 });

      // insert data
      const writeReply1 = await handleRecordsWrite(alice.did, write1.message, messageStore, didResolver);
      const writeReply2 = await handleRecordsWrite(alice.did, write2.message, messageStore, didResolver);
      const writeReply3 = await handleRecordsWrite(alice.did, write3.message, messageStore, didResolver);
      expect(writeReply1.status.code).to.equal(202);
      expect(writeReply2.status.code).to.equal(202);
      expect(writeReply3.status.code).to.equal(202);

      // testing `from` range
      const lastDayOf2021 = Temporal.PlainDateTime.from({ year: 2021, month: 12, day: 31 }).toString({ smallestUnit: 'microseconds' });
      const recordsQuery1 = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { dateCreated: { from: lastDayOf2021 } },
        dateSort  : DateSort.CreatedAscending
      });
      const reply1 = await handleRecordsQuery(alice.did, recordsQuery1.message, messageStore, didResolver);
      expect(reply1.entries?.length).to.equal(2);
      expect((reply1.entries[0] as RecordsWriteMessage).encodedData).to.equal(write2.message.encodedData);
      expect((reply1.entries[1] as RecordsWriteMessage).encodedData).to.equal(write3.message.encodedData);

      // testing `to` range
      const lastDayOf2022 = Temporal.PlainDateTime.from({ year: 2022, month: 12, day: 31 }).toString({ smallestUnit: 'microseconds' });
      const recordsQuery2 = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { dateCreated: { to: lastDayOf2022 } },
        dateSort  : DateSort.CreatedAscending
      });
      const reply2 = await handleRecordsQuery(alice.did, recordsQuery2.message, messageStore, didResolver);
      expect(reply2.entries?.length).to.equal(2);
      expect((reply2.entries[0] as RecordsWriteMessage).encodedData).to.equal(write1.message.encodedData);
      expect((reply2.entries[1] as RecordsWriteMessage).encodedData).to.equal(write2.message.encodedData);

      // testing `from` and `to` range
      const lastDayOf2023 = Temporal.PlainDateTime.from({ year: 2023, month: 12, day: 31 }).toString({ smallestUnit: 'microseconds' });
      const recordsQuery3 = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { dateCreated: { from: lastDayOf2022, to: lastDayOf2023 } },
        dateSort  : DateSort.CreatedAscending
      });
      const reply3 = await handleRecordsQuery(alice.did, recordsQuery3.message, messageStore, didResolver);
      expect(reply3.entries?.length).to.equal(1);
      expect((reply3.entries[0] as RecordsWriteMessage).encodedData).to.equal(write3.message.encodedData);

      // testing edge case where value equals `from` and `to`
      const recordsQuery4 = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { dateCreated: { from: firstDayOf2022, to: firstDayOf2023 } },
        dateSort  : DateSort.CreatedAscending
      });
      const reply4 = await handleRecordsQuery(alice.did, recordsQuery4.message, messageStore, didResolver);
      expect(reply4.entries?.length).to.equal(2);
      expect((reply4.entries[0] as RecordsWriteMessage).encodedData).to.equal(write2.message.encodedData);
      expect((reply4.entries[1] as RecordsWriteMessage).encodedData).to.equal(write3.message.encodedData);
    });

    it('should be able use range and exact match queries at the same time', async () => {
      // scenario: 3 records authored by alice, created on first of 2021, 2022, and 2023 respectively, only the first 2 records share the same schema
      const firstDayOf2021 = Temporal.PlainDateTime.from({ year: 2021, month: 1, day: 1 }).toString({ smallestUnit: 'microseconds' });
      const firstDayOf2022 = Temporal.PlainDateTime.from({ year: 2022, month: 1, day: 1 }).toString({ smallestUnit: 'microseconds' });
      const firstDayOf2023 = Temporal.PlainDateTime.from({ year: 2023, month: 1, day: 1 }).toString({ smallestUnit: 'microseconds' });
      const alice = await DidKeyResolver.generate();
      const schema = '2021And2022Schema';
      const write1 = await TestDataGenerator.generateRecordsWrite({
        requester: alice, dateCreated: firstDayOf2021, dateModified: firstDayOf2021, schema
      });
      const write2 = await TestDataGenerator.generateRecordsWrite({
        requester: alice, dateCreated: firstDayOf2022, dateModified: firstDayOf2022, schema
      });
      const write3 = await TestDataGenerator.generateRecordsWrite({
        requester: alice, dateCreated: firstDayOf2023, dateModified: firstDayOf2023
      });

      // insert data
      const writeReply1 = await handleRecordsWrite(alice.did, write1.message, messageStore, didResolver);
      const writeReply2 = await handleRecordsWrite(alice.did, write2.message, messageStore, didResolver);
      const writeReply3 = await handleRecordsWrite(alice.did, write3.message, messageStore, didResolver);
      expect(writeReply1.status.code).to.equal(202);
      expect(writeReply2.status.code).to.equal(202);
      expect(writeReply3.status.code).to.equal(202);

      // testing range criterion with another exact match
      const lastDayOf2021 = Temporal.PlainDateTime.from({ year: 2021, month: 12, day: 31 }).toString({ smallestUnit: 'microseconds' });
      const lastDayOf2023 = Temporal.PlainDateTime.from({ year: 2023, month: 12, day: 31 }).toString({ smallestUnit: 'microseconds' });
      const recordsQuery5 = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : {
          schema, // by itself selects the first 2 records
          dateCreated: { from: lastDayOf2021, to: lastDayOf2023 } // by itself selects the last 2 records
        },
        dateSort: DateSort.CreatedAscending
      });
      const reply = await handleRecordsQuery(alice.did, recordsQuery5.message, messageStore, didResolver);
      expect(reply.entries?.length).to.equal(1);
      expect((reply.entries[0] as RecordsWriteMessage).encodedData).to.equal(write2.message.encodedData);
    });

    it('should not include `authorization` in returned records', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const { message } = await TestDataGenerator.generateRecordsWrite({ requester: alice });

      // setting up a stub method resolver
      const didResolverStub = TestStubGenerator.createDidResolverStub(alice);

      const writeReply = await handleRecordsWrite(alice.did, message, messageStore, didResolverStub);
      expect(writeReply.status.code).to.equal(202);

      const queryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { schema: message.descriptor.schema }
      });

      const queryReply = await handleRecordsQuery(alice.did, queryData.message, messageStore, didResolverStub);
      expect(queryReply.status.code).to.equal(200);
      expect(queryReply.entries?.length).to.equal(1);
      expect(queryReply.entries[0]['authorization']).to.equal(undefined);
    });

    it('should include `attestation` in returned records', async () => {
      // scenario: alice and bob attest to a message alice authored

      const alice = await DidKeyResolver.generate();
      const { message } = await TestDataGenerator.generateRecordsWrite({ requester: alice, attesters: [alice] });

      const writeReply = await handleRecordsWrite(alice.did, message, messageStore, didResolver);
      expect(writeReply.status.code).to.equal(202);

      const queryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { schema: message.descriptor.schema }
      });

      const queryReply = await handleRecordsQuery(alice.did, queryData.message, messageStore, didResolver);
      expect(queryReply.status.code).to.equal(200);
      expect(queryReply.entries?.length).to.equal(1);

      const recordsWriteMessage = queryReply.entries[0] as any;
      expect(recordsWriteMessage.attestation?.signatures?.length).to.equal(1);
    });

    it('should omit records that are not published if `dateSort` sorts on `datePublished`', async () => {
      // insert three messages into DB, two with matching protocol
      const alice = await TestDataGenerator.generatePersona();
      const schema = 'aSchema';
      const publishedWriteData = await TestDataGenerator.generateRecordsWrite({
        requester: alice, schema, published: true
      });
      const unpublishedWriteData = await TestDataGenerator.generateRecordsWrite({
        requester: alice, schema
      });

      // setting up a stub method resolver
      const didResolverStub = TestStubGenerator.createDidResolverStub(alice);

      // insert data
      const publishedWriteReply = await handleRecordsWrite(alice.did, publishedWriteData.message, messageStore, didResolverStub);
      const unpublishedWriteReply = await handleRecordsWrite(alice.did, unpublishedWriteData.message, messageStore, didResolverStub);
      expect(publishedWriteReply.status.code).to.equal(202);
      expect(unpublishedWriteReply.status.code).to.equal(202);

      // test published date ascending sort does not include any records that is not published
      const publishedAscendingQueryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        dateSort  : DateSort.PublishedAscending,
        filter    : { schema }
      });
      const publishedAscendingQueryReply = await handleRecordsQuery(alice.did, publishedAscendingQueryData.message, messageStore, didResolverStub);

      expect(publishedAscendingQueryReply.entries?.length).to.equal(1);
      expect(publishedAscendingQueryReply.entries[0].descriptor['datePublished']).to.equal(publishedWriteData.message.descriptor.datePublished);

      // test published date scending sort does not include any records that is not published
      const publishedDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        dateSort  : DateSort.PublishedDescending,
        filter    : { schema }
      });
      const publishedDescendingQueryReply = await handleRecordsQuery(alice.did, publishedDescendingQueryData.message, messageStore, didResolverStub);

      expect(publishedDescendingQueryReply.entries?.length).to.equal(1);
      expect(publishedDescendingQueryReply.entries[0].descriptor['datePublished']).to.equal(publishedWriteData.message.descriptor.datePublished);
    });

    it('should sort records if `dateSort` is specified', async () => {
      // insert three messages into DB, two with matching protocol
      const alice = await TestDataGenerator.generatePersona();
      const schema = 'aSchema';
      const published = true;
      const write1Data = await TestDataGenerator.generateRecordsWrite({ requester: alice, schema, published });
      const write2Data = await TestDataGenerator.generateRecordsWrite({ requester: alice, schema, published });
      const write3Data = await TestDataGenerator.generateRecordsWrite({ requester: alice, schema, published });

      // setting up a stub method resolver
      const didResolverStub = TestStubGenerator.createDidResolverStub(alice);

      // insert data, intentionally out of order
      const writeReply2 = await handleRecordsWrite(alice.did, write2Data.message, messageStore, didResolverStub);
      const writeReply1 = await handleRecordsWrite(alice.did, write1Data.message, messageStore, didResolverStub);
      const writeReply3 = await handleRecordsWrite(alice.did, write3Data.message, messageStore, didResolverStub);
      expect(writeReply1.status.code).to.equal(202);
      expect(writeReply2.status.code).to.equal(202);
      expect(writeReply3.status.code).to.equal(202);

      // createdAscending test
      const createdAscendingQueryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        dateSort  : DateSort.CreatedAscending,
        filter    : { schema }
      });
      const createdAscendingQueryReply = await handleRecordsQuery(alice.did, createdAscendingQueryData.message, messageStore, didResolverStub);

      expect(createdAscendingQueryReply.entries[0].descriptor['dateCreated']).to.equal(write1Data.message.descriptor.dateCreated);
      expect(createdAscendingQueryReply.entries[1].descriptor['dateCreated']).to.equal(write2Data.message.descriptor.dateCreated);
      expect(createdAscendingQueryReply.entries[2].descriptor['dateCreated']).to.equal(write3Data.message.descriptor.dateCreated);

      // createdDescending test
      const createdDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        dateSort  : DateSort.CreatedDescending,
        filter    : { schema }
      });
      const createdDescendingQueryReply = await handleRecordsQuery(alice.did, createdDescendingQueryData.message, messageStore, didResolverStub);

      expect(createdDescendingQueryReply.entries[0].descriptor['dateCreated']).to.equal(write3Data.message.descriptor.dateCreated);
      expect(createdDescendingQueryReply.entries[1].descriptor['dateCreated']).to.equal(write2Data.message.descriptor.dateCreated);
      expect(createdDescendingQueryReply.entries[2].descriptor['dateCreated']).to.equal(write1Data.message.descriptor.dateCreated);

      // publishedAscending test
      const publishedAscendingQueryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        dateSort  : DateSort.PublishedAscending,
        filter    : { schema }
      });
      const publishedAscendingQueryReply = await handleRecordsQuery(alice.did, publishedAscendingQueryData.message, messageStore, didResolverStub);

      expect(publishedAscendingQueryReply.entries[0].descriptor['datePublished']).to.equal(write1Data.message.descriptor.datePublished);
      expect(publishedAscendingQueryReply.entries[1].descriptor['datePublished']).to.equal(write2Data.message.descriptor.datePublished);
      expect(publishedAscendingQueryReply.entries[2].descriptor['datePublished']).to.equal(write3Data.message.descriptor.datePublished);

      // publishedDescending test
      const publishedDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        dateSort  : DateSort.PublishedDescending,
        filter    : { schema }
      });
      const publishedDescendingQueryReply = await handleRecordsQuery(alice.did, publishedDescendingQueryData.message, messageStore, didResolverStub);

      expect(publishedDescendingQueryReply.entries[0].descriptor['datePublished']).to.equal(write3Data.message.descriptor.datePublished);
      expect(publishedDescendingQueryReply.entries[1].descriptor['datePublished']).to.equal(write2Data.message.descriptor.datePublished);
      expect(publishedDescendingQueryReply.entries[2].descriptor['datePublished']).to.equal(write1Data.message.descriptor.datePublished);
    });

    it('should only return published records and unpublished records that is meant for requester', async () => {
      // write three records into Alice's DB:
      // 1st is unpublished
      // 2nd is also unpublished but is meant for (has recipient as) Bob
      // 3rd is also unpublished but is authored (sent) by Bob
      // 4th is published
      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();
      const schema = 'schema1';
      const record1Data = await TestDataGenerator.generateRecordsWrite(
        { requester: alice, schema, data: Encoder.stringToBytes('1') }
      );
      const record2Data = await TestDataGenerator.generateRecordsWrite(
        { requester: alice, schema, data: Encoder.stringToBytes('2'), recipientDid: bob.did }
      );
      const record3Data = await TestDataGenerator.generateRecordsWrite(
        { requester: bob, recipientDid: alice.did, schema, data: Encoder.stringToBytes('3') }
      );
      const record4Data = await TestDataGenerator.generateRecordsWrite(
        { requester: alice, schema, data: Encoder.stringToBytes('4'), published: true }
      );

      // directly inserting data to datastore so that we don't have to setup to grant Bob permission to write to Alice's DWN
      const additionalIndexes1 = await constructRecordsWriteIndexes(alice.did, record1Data.recordsWrite, true);
      const additionalIndexes2 = await constructRecordsWriteIndexes(alice.did, record2Data.recordsWrite, true);
      const additionalIndexes3 = await constructRecordsWriteIndexes(alice.did, record3Data.recordsWrite, true);
      const additionalIndexes4 = await constructRecordsWriteIndexes(alice.did, record4Data.recordsWrite, true);
      await messageStore.put(record1Data.message, additionalIndexes1);
      await messageStore.put(record2Data.message, additionalIndexes2);
      await messageStore.put(record3Data.message, additionalIndexes3);
      await messageStore.put(record4Data.message, additionalIndexes4);

      // test correctness for Bob's query
      const bobQueryMessageData = await TestDataGenerator.generateRecordsQuery({
        requester : bob,
        filter    : { schema }
      });

      const replyToBob = await handleRecordsQuery(alice.did, bobQueryMessageData.message, messageStore, didResolver);

      expect(replyToBob.status.code).to.equal(200);
      expect(replyToBob.entries?.length).to.equal(3); // expect 3 records

      const privateRecordsForBob = replyToBob.entries.filter(message => (message as any).encodedData === Encoder.stringToBase64Url('2'));
      const privateRecordsFromBob = replyToBob.entries.filter(message => (message as any).encodedData === Encoder.stringToBase64Url('3'));
      const publicRecords = replyToBob.entries.filter(message => (message as any).encodedData === Encoder.stringToBase64Url('4'));
      expect(privateRecordsForBob.length).to.equal(1);
      expect(privateRecordsFromBob.length).to.equal(1);
      expect(publicRecords.length).to.equal(1);

      // test correctness for Alice's query
      const aliceQueryMessageData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { schema }
      });

      const replyToAliceQuery = await handleRecordsQuery(alice.did, aliceQueryMessageData.message, messageStore, didResolver);

      expect(replyToAliceQuery.status.code).to.equal(200);
      expect(replyToAliceQuery.entries?.length).to.equal(4); // expect all 4 records
    });

    // https://github.com/TBD54566975/dwn-sdk-js/issues/170
    it('#170 - should treat records with `published` explicitly set to `false` as unpublished', async () => {
      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();
      const schema = 'schema1';
      const unpublishedRecordsWrite = await TestDataGenerator.generateRecordsWrite(
        { requester: alice, schema, data: Encoder.stringToBytes('1'), published: false } // explicitly setting `published` to `false`
      );

      const result1 = await handleRecordsWrite(alice.did, unpublishedRecordsWrite.message, messageStore, didResolver);
      expect(result1.status.code).to.equal(202);

      // alice should be able to see the unpublished record
      const queryByAlice = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { schema }
      });
      const replyToAliceQuery = await handleRecordsQuery(alice.did, queryByAlice.message, messageStore, didResolver);
      expect(replyToAliceQuery.status.code).to.equal(200);
      expect(replyToAliceQuery.entries?.length).to.equal(1);

      // actual test: bob should not be able to see unpublished record
      const queryByBob = await TestDataGenerator.generateRecordsQuery({
        requester : bob,
        filter    : { schema }
      });
      const replyToBobQuery = await handleRecordsQuery(alice.did, queryByBob.message, messageStore, didResolver);
      expect(replyToBobQuery.status.code).to.equal(200);
      expect(replyToBobQuery.entries?.length).to.equal(0);
    });

    it('should throw if a non-owner requester querying for records not intended for the requester (as recipient)', async () => {
      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();
      const carol = await DidKeyResolver.generate();

      const bobQueryMessageData = await TestDataGenerator.generateRecordsQuery({
        requester : bob,
        filter    : { recipient: carol.did } // bob querying carol's records
      });

      const replyToBobQuery = await handleRecordsQuery(alice.did, bobQueryMessageData.message, messageStore, didResolver);

      expect(replyToBobQuery.status.code).to.equal(401);
      expect(replyToBobQuery.status.detail).to.contain('not allowed to query records');
    });

    it('should allow DWN owner to use `recipient` as a filter in queries', async () => {
      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();

      const bobQueryMessageData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { recipient: bob.did } // alice as the DWN owner querying bob's records
      });

      const replyToBobQuery = await handleRecordsQuery(alice.did, bobQueryMessageData.message, messageStore, didResolver);

      expect(replyToBobQuery.status.code).to.equal(200);
    });

    it('should not fetch entries across tenants', async () => {
      // insert three messages into DB, two with matching schema
      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();
      const schema = 'myAwesomeSchema';
      const recordsWriteMessage1Data = await TestDataGenerator.generateRecordsWrite({ requester: alice, schema });
      const recordsWriteMessage2Data = await TestDataGenerator.generateRecordsWrite({ requester: bob, schema });

      const aliceQueryMessageData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { schema }
      });

      // insert data into 2 different tenants
      const didResolver = new DidResolver([new DidKeyResolver()]);
      await handleRecordsWrite(alice.did, recordsWriteMessage1Data.message, messageStore, didResolver);
      await handleRecordsWrite(bob.did, recordsWriteMessage2Data.message, messageStore, didResolver);

      const reply = await handleRecordsQuery(alice.did, aliceQueryMessageData.message, messageStore, didResolver);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(1);
    });
  });

  it('should return 401 if signature check fails', async () => {
    const { requester, message } = await TestDataGenerator.generateRecordsQuery();

    // setting up a stub did resolver & message store
    // intentionally not supplying the public key so a different public key is generated to simulate invalid signature
    const mismatchingPersona = await TestDataGenerator.generatePersona({ did: requester.did, keyId: requester.keyId });
    const didResolverStub = TestStubGenerator.createDidResolverStub(mismatchingPersona);
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

    const tenant = requester.did;
    const reply = await handleRecordsQuery(tenant, message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(401);
  });

  it('should return 400 if fail parsing the message', async () => {
    const { requester, message } = await TestDataGenerator.generateRecordsQuery();
    const tenant = requester.did;

    // setting up a stub method resolver & message store
    const didResolverStub = TestStubGenerator.createDidResolverStub(requester);
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

    // stub the `parse()` function to throw an error
    sinon.stub(RecordsQuery, 'parse').throws('anyError');
    const reply = await handleRecordsQuery(tenant, message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(400);
  });
});

