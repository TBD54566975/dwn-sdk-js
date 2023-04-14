import type { RecordsQueryReplyEntry } from '../../../../src/interfaces/records/types.js';
import type { DerivedPrivateJwk, EncryptionInput, ProtocolDefinition, RecordsWriteMessage } from '../../../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import emailProtocolDefinition from '../../../vectors/protocol-definitions/email.json' assert { type: 'json' };
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { Comparer } from '../../../utils/comparer.js';
import { DataStoreLevel } from '../../../../src/store/data-store-level.js';
import { DidKeyResolver } from '../../../../src/did/did-key-resolver.js';
import { DwnConstant } from '../../../../src/core/dwn-constant.js';
import { Encoder } from '../../../../src/utils/encoder.js';
import { Encryption } from '../../../../src/index.js';
import { EventLogLevel } from '../../../../src/event-log/event-log-level.js';
import { Jws } from '../../../../src/utils/jws.js';
import { MessageStoreLevel } from '../../../../src/store/message-store-level.js';
import { RecordsQueryHandler } from '../../../../src/interfaces/records/handlers/records-query.js';
import { StorageController } from '../../../../src/store/storage-controller.js';
import { Temporal } from '@js-temporal/polyfill';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import { TestStubGenerator } from '../../../utils/test-stub-generator.js';

import { constructRecordsWriteIndexes } from '../../../../src/interfaces/records/handlers/records-write.js';
import { DataStream, DidResolver, Dwn, HdKey, KeyDerivationScheme, Records } from '../../../../src/index.js';
import { DateSort, RecordsQuery } from '../../../../src/interfaces/records/messages/records-query.js';

chai.use(chaiAsPromised);

describe('RecordsQueryHandler.handle()', () => {
  describe('functional tests', () => {
    let didResolver: DidResolver;
    let messageStore: MessageStoreLevel;
    let dataStore: DataStoreLevel;
    let eventLog: EventLogLevel;
    let dwn: Dwn;

    before(async () => {
      didResolver = new DidResolver([new DidKeyResolver()]);

      // important to follow this pattern to initialize and clean the message and data store in tests
      // so that different suites can reuse the same block store and index location for testing
      messageStore = new MessageStoreLevel({
        blockstoreLocation : 'TEST-MESSAGESTORE',
        indexLocation      : 'TEST-INDEX'
      });

      dataStore = new DataStoreLevel({
        blockstoreLocation: 'TEST-DATASTORE'
      });

      eventLog = new EventLogLevel({
        location: 'TEST-EVENTLOG'
      });

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

    it('should return records matching the query', async () => {
      // insert three messages into DB, two with matching protocol
      const alice = await TestDataGenerator.generatePersona();
      const dataFormat = 'myAwesomeDataFormat';
      const write1 = await TestDataGenerator.generateRecordsWrite({ requester: alice });
      const write2 = await TestDataGenerator.generateRecordsWrite({ requester: alice, dataFormat, schema: 'schema1' });
      const write3 = await TestDataGenerator.generateRecordsWrite({ requester: alice, dataFormat, schema: 'schema2' });

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
      const messageData = await TestDataGenerator.generateRecordsQuery({ requester: alice, filter: { dataFormat } });

      const reply = await dwn.processMessage(alice.did, messageData.message);

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

      const reply2 = await dwn.processMessage(alice.did, messageData2.message);

      expect(reply2.status.code).to.equal(200);
      expect(reply2.entries?.length).to.equal(1); // only 1 entry should match the query
    });

    it('should return `encodedData` if data size is within the spec threshold', async () => {
      const data = TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded); // within/on threshold
      const alice = await DidKeyResolver.generate();
      const write= await TestDataGenerator.generateRecordsWrite({ requester: alice, data });

      const writeReply = await dwn.processMessage(alice.did, write.message, write.dataStream);
      expect(writeReply.status.code).to.equal(202);

      const messageData = await TestDataGenerator.generateRecordsQuery({ requester: alice, filter: { recordId: write.message.recordId } });
      const reply = await dwn.processMessage(alice.did, messageData.message);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(1);
      expect(reply.entries![0].encodedData).to.equal(Encoder.bytesToBase64Url(data));
    });

    it('should not return `encodedData` if data size is greater then spec threshold', async () => {
      const data = TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 1); // exceeding threshold
      const alice = await DidKeyResolver.generate();
      const write= await TestDataGenerator.generateRecordsWrite({ requester: alice, data });

      const writeReply = await dwn.processMessage(alice.did, write.message, write.dataStream);
      expect(writeReply.status.code).to.equal(202);

      const messageData = await TestDataGenerator.generateRecordsQuery({ requester: alice, filter: { recordId: write.message.recordId } });
      const reply = await dwn.processMessage(alice.did, messageData.message);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(1);
      expect(reply.entries![0].encodedData).to.be.undefined;
    });

    it('should be able to query by attester', async () => {
      // scenario: 2 records authored by alice, 1st attested by alice, 2nd attested by bob
      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();
      const recordsWrite1 = await TestDataGenerator.generateRecordsWrite({ requester: alice, attesters: [alice] });
      const recordsWrite2 = await TestDataGenerator.generateRecordsWrite({ requester: alice, attesters: [bob] });

      // insert data
      const writeReply1 = await dwn.processMessage(alice.did, recordsWrite1.message, recordsWrite1.dataStream);
      const writeReply2 = await dwn.processMessage(alice.did, recordsWrite2.message, recordsWrite2.dataStream);
      expect(writeReply1.status.code).to.equal(202);
      expect(writeReply2.status.code).to.equal(202);

      // testing attester filter
      const recordsQuery1 = await TestDataGenerator.generateRecordsQuery({ requester: alice, filter: { attester: alice.did } });
      const reply1 = await dwn.processMessage(alice.did, recordsQuery1.message);
      expect(reply1.entries?.length).to.equal(1);
      const reply1Attester = Jws.getSignerDid((reply1.entries![0] as RecordsWriteMessage).attestation!.signatures[0]);
      expect(reply1Attester).to.equal(alice.did);

      // testing attester + another filter
      const recordsQuery2 = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { attester: bob.did, schema: recordsWrite2.message.descriptor.schema }
      });
      const reply2 = await dwn.processMessage(alice.did, recordsQuery2.message);
      expect(reply2.entries?.length).to.equal(1);
      const reply2Attester = Jws.getSignerDid((reply2.entries![0] as RecordsWriteMessage).attestation!.signatures[0]);
      expect(reply2Attester).to.equal(bob.did);

      // testing attester filter that yields no results
      const carol = await DidKeyResolver.generate();
      const recordsQuery3 = await TestDataGenerator.generateRecordsQuery({ requester: alice, filter: { attester: carol.did } });
      const reply3 = await dwn.processMessage(alice.did, recordsQuery3.message);
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
      const writeReply1 = await dwn.processMessage(alice.did, write1.message, write1.dataStream);
      const writeReply2 = await dwn.processMessage(alice.did, write2.message, write2.dataStream);
      const writeReply3 = await dwn.processMessage(alice.did, write3.message, write3.dataStream);
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
      const reply1 = await dwn.processMessage(alice.did, recordsQuery1.message);
      expect(reply1.entries?.length).to.equal(2);
      expect(reply1.entries![0].encodedData).to.equal(Encoder.bytesToBase64Url(write2.dataBytes!));
      expect(reply1.entries![1].encodedData).to.equal(Encoder.bytesToBase64Url(write3.dataBytes!));

      // testing `to` range
      const lastDayOf2022 = Temporal.PlainDateTime.from({ year: 2022, month: 12, day: 31 }).toString({ smallestUnit: 'microseconds' });
      const recordsQuery2 = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { dateCreated: { to: lastDayOf2022 } },
        dateSort  : DateSort.CreatedAscending
      });
      const reply2 = await dwn.processMessage(alice.did, recordsQuery2.message);
      expect(reply2.entries?.length).to.equal(2);
      expect(reply2.entries![0].encodedData).to.equal(Encoder.bytesToBase64Url(write1.dataBytes!));
      expect(reply2.entries![1].encodedData).to.equal(Encoder.bytesToBase64Url(write2.dataBytes!));

      // testing `from` and `to` range
      const lastDayOf2023 = Temporal.PlainDateTime.from({ year: 2023, month: 12, day: 31 }).toString({ smallestUnit: 'microseconds' });
      const recordsQuery3 = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { dateCreated: { from: lastDayOf2022, to: lastDayOf2023 } },
        dateSort  : DateSort.CreatedAscending
      });
      const reply3 = await dwn.processMessage(alice.did, recordsQuery3.message);
      expect(reply3.entries?.length).to.equal(1);
      expect(reply3.entries![0].encodedData).to.equal(Encoder.bytesToBase64Url(write3.dataBytes!));

      // testing edge case where value equals `from` and `to`
      const recordsQuery4 = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { dateCreated: { from: firstDayOf2022, to: firstDayOf2023 } },
        dateSort  : DateSort.CreatedAscending
      });
      const reply4 = await dwn.processMessage(alice.did, recordsQuery4.message);
      expect(reply4.entries?.length).to.equal(1);
      expect(reply4.entries![0].encodedData).to.equal(Encoder.bytesToBase64Url(write2.dataBytes!));
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
      const writeReply1 = await dwn.processMessage(alice.did, write1.message, write1.dataStream);
      const writeReply2 = await dwn.processMessage(alice.did, write2.message, write2.dataStream);
      const writeReply3 = await dwn.processMessage(alice.did, write3.message, write3.dataStream);
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
      const reply = await dwn.processMessage(alice.did, recordsQuery5.message);
      expect(reply.entries?.length).to.equal(1);
      expect(reply.entries![0].encodedData).to.equal(Encoder.bytesToBase64Url(write2.dataBytes!));
    });

    it('should not include `authorization` in returned records', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice });

      // setting up a stub method resolver
      const mockResolution = TestDataGenerator.createDidResolutionResult(alice);;
      sinon.stub(didResolver, 'resolve').resolves(mockResolution);

      const writeReply = await dwn.processMessage(alice.did, message, dataStream);
      expect(writeReply.status.code).to.equal(202);

      const queryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { schema: message.descriptor.schema }
      });

      const queryReply = await dwn.processMessage(alice.did, queryData.message);
      expect(queryReply.status.code).to.equal(200);
      expect(queryReply.entries?.length).to.equal(1);
      expect(queryReply.entries![0]['authorization']).to.equal(undefined);
    });

    it('should include `attestation` in returned records', async () => {
      // scenario: alice and bob attest to a message alice authored

      const alice = await DidKeyResolver.generate();
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice, attesters: [alice] });

      const writeReply = await dwn.processMessage(alice.did, message, dataStream);
      expect(writeReply.status.code).to.equal(202);

      const queryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { schema: message.descriptor.schema }
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
        requester: alice, schema, published: true
      });
      const unpublishedWriteData = await TestDataGenerator.generateRecordsWrite({
        requester: alice, schema
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
        requester : alice,
        dateSort  : DateSort.PublishedAscending,
        filter    : { schema }
      });
      const publishedAscendingQueryReply = await dwn.processMessage(alice.did, publishedAscendingQueryData.message);

      expect(publishedAscendingQueryReply.entries?.length).to.equal(1);
      expect(publishedAscendingQueryReply.entries![0].descriptor['datePublished']).to.equal(publishedWriteData.message.descriptor.datePublished);

      // test published date scending sort does not include any records that is not published
      const publishedDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        dateSort  : DateSort.PublishedDescending,
        filter    : { schema }
      });
      const publishedDescendingQueryReply = await dwn.processMessage(alice.did, publishedDescendingQueryData.message);

      expect(publishedDescendingQueryReply.entries?.length).to.equal(1);
      expect(publishedDescendingQueryReply.entries![0].descriptor['datePublished']).to.equal(publishedWriteData.message.descriptor.datePublished);
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
        requester : alice,
        dateSort  : DateSort.CreatedAscending,
        filter    : { schema }
      });
      const createdAscendingQueryReply = await dwn.processMessage(alice.did, createdAscendingQueryData.message);

      expect(createdAscendingQueryReply.entries?.[0].descriptor['dateCreated']).to.equal(write1Data.message.descriptor.dateCreated);
      expect(createdAscendingQueryReply.entries?.[1].descriptor['dateCreated']).to.equal(write2Data.message.descriptor.dateCreated);
      expect(createdAscendingQueryReply.entries?.[2].descriptor['dateCreated']).to.equal(write3Data.message.descriptor.dateCreated);

      // createdDescending test
      const createdDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        dateSort  : DateSort.CreatedDescending,
        filter    : { schema }
      });
      const createdDescendingQueryReply = await dwn.processMessage(alice.did, createdDescendingQueryData.message);

      expect(createdDescendingQueryReply.entries?.[0].descriptor['dateCreated']).to.equal(write3Data.message.descriptor.dateCreated);
      expect(createdDescendingQueryReply.entries?.[1].descriptor['dateCreated']).to.equal(write2Data.message.descriptor.dateCreated);
      expect(createdDescendingQueryReply.entries?.[2].descriptor['dateCreated']).to.equal(write1Data.message.descriptor.dateCreated);

      // publishedAscending test
      const publishedAscendingQueryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        dateSort  : DateSort.PublishedAscending,
        filter    : { schema }
      });
      const publishedAscendingQueryReply = await dwn.processMessage(alice.did, publishedAscendingQueryData.message);

      expect(publishedAscendingQueryReply.entries?.[0].descriptor['datePublished']).to.equal(write1Data.message.descriptor.datePublished);
      expect(publishedAscendingQueryReply.entries?.[1].descriptor['datePublished']).to.equal(write2Data.message.descriptor.datePublished);
      expect(publishedAscendingQueryReply.entries?.[2].descriptor['datePublished']).to.equal(write3Data.message.descriptor.datePublished);

      // publishedDescending test
      const publishedDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        dateSort  : DateSort.PublishedDescending,
        filter    : { schema }
      });
      const publishedDescendingQueryReply = await dwn.processMessage(alice.did, publishedDescendingQueryData.message);

      expect(publishedDescendingQueryReply.entries?.[0].descriptor['datePublished']).to.equal(write3Data.message.descriptor.datePublished);
      expect(publishedDescendingQueryReply.entries?.[1].descriptor['datePublished']).to.equal(write2Data.message.descriptor.datePublished);
      expect(publishedDescendingQueryReply.entries?.[2].descriptor['datePublished']).to.equal(write1Data.message.descriptor.datePublished);
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
      const additionalIndexes1 = await constructRecordsWriteIndexes(record1Data.recordsWrite, true);
      const additionalIndexes2 = await constructRecordsWriteIndexes(record2Data.recordsWrite, true);
      const additionalIndexes3 = await constructRecordsWriteIndexes(record3Data.recordsWrite, true);
      const additionalIndexes4 = await constructRecordsWriteIndexes(record4Data.recordsWrite, true);
      await StorageController.put(messageStore, dataStore, eventLog, alice.did, record1Data.message, additionalIndexes1, record1Data.dataStream);
      await StorageController.put(messageStore, dataStore, eventLog, alice.did, record2Data.message, additionalIndexes2, record2Data.dataStream);
      await StorageController.put(messageStore, dataStore, eventLog, alice.did, record3Data.message, additionalIndexes3, record3Data.dataStream);
      await StorageController.put(messageStore, dataStore, eventLog, alice.did, record4Data.message, additionalIndexes4, record4Data.dataStream);

      // test correctness for Bob's query
      const bobQueryMessageData = await TestDataGenerator.generateRecordsQuery({
        requester : bob,
        filter    : { schema }
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
        requester : alice,
        filter    : { schema }
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
        { requester: alice, schema, data: Encoder.stringToBytes('1'), published: false } // explicitly setting `published` to `false`
      );

      const result1 = await dwn.processMessage(alice.did, unpublishedRecordsWrite.message, unpublishedRecordsWrite.dataStream);
      expect(result1.status.code).to.equal(202);

      // alice should be able to see the unpublished record
      const queryByAlice = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { schema }
      });
      const replyToAliceQuery = await dwn.processMessage(alice.did, queryByAlice.message);
      expect(replyToAliceQuery.status.code).to.equal(200);
      expect(replyToAliceQuery.entries?.length).to.equal(1);

      // actual test: bob should not be able to see unpublished record
      const queryByBob = await TestDataGenerator.generateRecordsQuery({
        requester : bob,
        filter    : { schema }
      });
      const replyToBobQuery = await dwn.processMessage(alice.did, queryByBob.message);
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

      const replyToBobQuery = await dwn.processMessage(alice.did, bobQueryMessageData.message);

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

      const replyToBobQuery = await dwn.processMessage(alice.did, bobQueryMessageData.message);

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
      await dwn.processMessage(alice.did, recordsWriteMessage1Data.message, recordsWriteMessage1Data.dataStream);
      await dwn.processMessage(bob.did, recordsWriteMessage2Data.message, recordsWriteMessage2Data.dataStream);

      const reply = await dwn.processMessage(alice.did, aliceQueryMessageData.message);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(1);
    });

    describe('encryption scenarios', () => {
      it('should only be able to decrypt record with a correct derived private key', async () => {
        // scenario, Bob writes into Alice's DWN an encrypted "email", alice is able to decrypt it

        // creating Alice and Bob persona and setting up a stub DID resolver
        const alice = await TestDataGenerator.generatePersona();
        const bob = await TestDataGenerator.generatePersona();
        TestStubGenerator.stubDidResolver(didResolver, [alice, bob]);

        // configure protocol
        const protocol = 'email-protocol';
        const protocolDefinition: ProtocolDefinition = emailProtocolDefinition;
        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
          protocolDefinition
        });

        const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
        expect(protocolsConfigureReply.status.code).to.equal(202);

        // encrypt bob's message
        const bobMessageBytes = Encoder.stringToBytes('message from bob');
        const bobMessageStream = DataStream.fromBytes(bobMessageBytes);
        const dataEncryptionInitializationVector = TestDataGenerator.randomBytes(16);
        const dataEncryptionKey = TestDataGenerator.randomBytes(32);
        const bobMessageEncryptedStream = await Encryption.aes256CtrEncrypt(dataEncryptionKey, dataEncryptionInitializationVector, bobMessageStream);
        const bobMessageEncryptedBytes = await DataStream.toBytes(bobMessageEncryptedStream);

        // generate a `RecordsWrite` message from bob allowed by anyone
        const encryptionInput: EncryptionInput = {
          initializationVector : dataEncryptionInitializationVector,
          key                  : dataEncryptionKey,
          keyEncryptionInputs  : [{
            publicKey: {
              derivationScheme : KeyDerivationScheme.ProtocolContext,
              derivationPath   : [],
              derivedPublicKey : alice.keyPair.publicJwk // reusing signing key for encryption purely as a convenience
            }
          }]
        };

        const schema = 'email';
        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite(
          {
            requester : bob,
            protocol,
            schema,
            data      : bobMessageEncryptedBytes,
            encryptionInput
          }
        );

        const bobWriteReply = await dwn.processMessage(alice.did, message, dataStream);
        expect(bobWriteReply.status.code).to.equal(202);

        const recordsQuery = await RecordsQuery.create({
          filter                      : { schema },
          authorizationSignatureInput : Jws.createSignatureInput(alice)
        });
        const queryReply = await dwn.processMessage(alice.did, recordsQuery.message);
        expect(queryReply.status.code).to.equal(200);

        const unsignedRecordsWrite = queryReply.entries![0] as RecordsQueryReplyEntry;

        // test able to decrypt the message using a derived key
        const rootPrivateKey: DerivedPrivateJwk = {
          derivationScheme  : KeyDerivationScheme.ProtocolContext,
          derivationPath    : [],
          derivedPrivateKey : alice.keyPair.privateJwk
        };
        const relativeDescendantDerivationPath = [KeyDerivationScheme.ProtocolContext, protocol, message.contextId!];
        const descendantPrivateKey: DerivedPrivateJwk = await HdKey.derivePrivateKey(rootPrivateKey, relativeDescendantDerivationPath);

        const cipherStream = DataStream.fromBytes(Encoder.base64UrlToBytes(unsignedRecordsWrite.encodedData!));

        const plaintextDataStream = await Records.decrypt(unsignedRecordsWrite, descendantPrivateKey, cipherStream);
        const plaintextBytes = await DataStream.toBytes(plaintextDataStream);
        expect(Comparer.byteArraysEqual(plaintextBytes, bobMessageBytes)).to.be.true;
      });
    });
  });

  it('should return 401 if signature check fails', async () => {
    const { requester, message } = await TestDataGenerator.generateRecordsQuery();
    const tenant = requester.did;

    // setting up a stub did resolver & message store
    // intentionally not supplying the public key so a different public key is generated to simulate invalid signature
    const mismatchingPersona = await TestDataGenerator.generatePersona({ did: requester.did, keyId: requester.keyId });
    const didResolver = TestStubGenerator.createDidResolverStub(mismatchingPersona);
    const messageStore = sinon.createStubInstance(MessageStoreLevel);
    const dataStore = sinon.createStubInstance(DataStoreLevel);

    const recordsQueryHandler = new RecordsQueryHandler(didResolver, messageStore, dataStore);
    const reply = await recordsQueryHandler.handle({ tenant, message });

    expect(reply.status.code).to.equal(401);
  });

  it('should return 400 if fail parsing the message', async () => {
    const { requester, message } = await TestDataGenerator.generateRecordsQuery();
    const tenant = requester.did;

    // setting up a stub method resolver & message store
    const didResolver = TestStubGenerator.createDidResolverStub(requester);
    const messageStore = sinon.createStubInstance(MessageStoreLevel);
    const dataStore = sinon.createStubInstance(DataStoreLevel);
    const recordsQueryHandler = new RecordsQueryHandler(didResolver, messageStore, dataStore);

    // stub the `parse()` function to throw an error
    sinon.stub(RecordsQuery, 'parse').throws('anyError');
    const reply = await recordsQueryHandler.handle({ tenant, message });

    expect(reply.status.code).to.equal(400);
  });
});

