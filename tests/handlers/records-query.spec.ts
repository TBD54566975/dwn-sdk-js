import type { EventStream } from '../../src/types/subscriptions.js';
import type { DataStore, EventLog, MessageStore } from '../../src/index.js';
import type { GenericMessage, RecordsWriteMessage } from '../../src/index.js';
import type { RecordsQueryReply, RecordsQueryReplyEntry, RecordsWriteDescriptor } from '../../src/types/records-types.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import freeForAll from '../vectors/protocol-definitions/free-for-all.json' assert { type: 'json' };
import friendRoleProtocolDefinition from '../vectors/protocol-definitions/friend-role.json' assert { type: 'json' };
import threadRoleProtocolDefinition from '../vectors/protocol-definitions/thread-role.json' assert { type: 'json' };

import { ArrayUtility } from '../../src/utils/array.js';
import { DateSort } from '../../src/types/records-types.js';
import { DwnConstant } from '../../src/core/dwn-constant.js';
import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { Encoder } from '../../src/utils/encoder.js';
import { Jws } from '../../src/utils/jws.js';
import { Message } from '../../src/core/message.js';
import { RecordsQuery } from '../../src/interfaces/records-query.js';
import { RecordsQueryHandler } from '../../src/handlers/records-query.js';
import { RecordsWriteHandler } from '../../src/handlers/records-write.js';
import { stubInterface } from 'ts-sinon';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { TestStubGenerator } from '../utils/test-stub-generator.js';
import { DidKeyMethod, DidResolver } from '@web5/dids';
import { Dwn, RecordsWrite, Time } from '../../src/index.js';

chai.use(chaiAsPromised);

export function testRecordsQueryHandler(): void {
  describe('RecordsQueryHandler.handle()', () => {
    describe('functional tests', () => {
      let didResolver: DidResolver;
      let messageStore: MessageStore;
      let dataStore: DataStore;
      let eventLog: EventLog;
      let eventStream: EventStream;
      let dwn: Dwn;

      // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
      // so that different test suites can reuse the same backend store for testing
      before(async () => {
        didResolver = new DidResolver({ didResolvers: [DidKeyMethod] });

        const stores = TestStores.get();
        messageStore = stores.messageStore;
        dataStore = stores.dataStore;
        eventLog = stores.eventLog;
        eventStream = TestEventStream.get();

        dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog, eventStream });
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

      it('should reject when published is set to false with a dateSort set to sorting by `PublishedAscending` or `PublishedDescending`', async () => {
        const alice = await TestDataGenerator.generatePersona();
        TestStubGenerator.stubDidResolver(didResolver, [alice]);

        const query = await TestDataGenerator.generateRecordsQuery({ author: alice, filter: { published: false } });

        //control
        let reply = await dwn.processMessage(alice.did, query.message);
        expect(reply.status.code).to.equal(200);

        // modify dateSort to publishedAscending
        query.message.descriptor.dateSort = DateSort.PublishedAscending;
        reply = await dwn.processMessage(alice.did, query.message);
        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.include('queries must not filter for `published:false` and sort');

        // modify dateSort to publishedDescending
        query.message.descriptor.dateSort = DateSort.PublishedDescending;
        reply = await dwn.processMessage(alice.did, query.message);
        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.include('queries must not filter for `published:false` and sort');
      });

      it('should return recordId, descriptor, authorization and attestation', async () => {
        const alice = await TestDataGenerator.generatePersona();
        const bob = await TestDataGenerator.generatePersona();
        TestStubGenerator.stubDidResolver(didResolver, [alice, bob]);
        const dataFormat = 'myAwesomeDataFormat';

        const write = await TestDataGenerator.generateRecordsWrite({ author: alice, attesters: [bob], dataFormat });
        const writeReply = await dwn.processMessage(alice.did, write.message, { dataStream: write.dataStream });
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
        const writeReply1 = await dwn.processMessage(alice.did, write1.message, { dataStream: write1.dataStream });
        const writeReply2 = await dwn.processMessage(alice.did, write2.message, { dataStream: write2.dataStream });
        const writeReply3 = await dwn.processMessage(alice.did, write3.message, { dataStream: write3.dataStream });
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
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const write= await TestDataGenerator.generateRecordsWrite({ author: alice, data });

        const writeReply = await dwn.processMessage(alice.did, write.message, { dataStream: write.dataStream });
        expect(writeReply.status.code).to.equal(202);

        const messageData = await TestDataGenerator.generateRecordsQuery({ author: alice, filter: { recordId: write.message.recordId } });
        const reply = await dwn.processMessage(alice.did, messageData.message);

        expect(reply.status.code).to.equal(200);
        expect(reply.entries?.length).to.equal(1);
        expect(reply.entries![0].encodedData).to.equal(Encoder.bytesToBase64Url(data));
      });

      it('should not return `encodedData` if data size is greater then spec threshold', async () => {
        const data = TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 1); // exceeding threshold
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const write= await TestDataGenerator.generateRecordsWrite({ author: alice, data });

        const writeReply = await dwn.processMessage(alice.did, write.message, { dataStream: write.dataStream });
        expect(writeReply.status.code).to.equal(202);

        const messageData = await TestDataGenerator.generateRecordsQuery({ author: alice, filter: { recordId: write.message.recordId } });
        const reply = await dwn.processMessage(alice.did, messageData.message);

        expect(reply.status.code).to.equal(200);
        expect(reply.entries?.length).to.equal(1);
        expect(reply.entries![0].encodedData).to.be.undefined;
      });

      it('should include `initialWrite` property if RecordsWrite is not initial write', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const write = await TestDataGenerator.generateRecordsWrite({ author: alice, published: false });

        const writeReply = await dwn.processMessage(alice.did, write.message, { dataStream: write.dataStream });
        expect(writeReply.status.code).to.equal(202);

        // write an update to the record
        const write2 = await RecordsWrite.createFrom({ recordsWriteMessage: write.message, published: true, signer: Jws.createSigner(alice) });
        const write2Reply = await dwn.processMessage(alice.did, write2.message);
        expect(write2Reply.status.code).to.equal(202);

        // make sure result returned now has `initialWrite` property
        const messageData = await TestDataGenerator.generateRecordsQuery({ author: alice, filter: { recordId: write.message.recordId } });
        const reply = await dwn.processMessage(alice.did, messageData.message);

        expect(reply.status.code).to.equal(200);
        expect(reply.entries?.length).to.equal(1);
        expect(reply.entries![0].initialWrite).to.exist;
        expect(reply.entries![0].initialWrite?.recordId).to.equal(write.message.recordId);

      });

      it('should be able to query by attester', async () => {
      // scenario: 2 records authored by alice, 1st attested by alice, 2nd attested by bob
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();
        const recordsWrite1 = await TestDataGenerator.generateRecordsWrite({ author: alice, attesters: [alice] });
        const recordsWrite2 = await TestDataGenerator.generateRecordsWrite({ author: alice, attesters: [bob] });

        // insert data
        const writeReply1 = await dwn.processMessage(alice.did, recordsWrite1.message, { dataStream: recordsWrite1.dataStream });
        const writeReply2 = await dwn.processMessage(alice.did, recordsWrite2.message, { dataStream: recordsWrite2.dataStream });
        expect(writeReply1.status.code).to.equal(202);
        expect(writeReply2.status.code).to.equal(202);

        // testing attester filter
        const recordsQuery1 = await TestDataGenerator.generateRecordsQuery({ author: alice, filter: { attester: alice.did } });
        const reply1 = await dwn.processMessage(alice.did, recordsQuery1.message);
        expect(reply1.entries?.length).to.equal(1);
        const reply1Attester = Jws.getSignerDid(reply1.entries![0].attestation!.signatures[0]);
        expect(reply1Attester).to.equal(alice.did);

        // testing attester + another filter
        const recordsQuery2 = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { attester: bob.did, schema: recordsWrite2.message.descriptor.schema }
        });
        const reply2 = await dwn.processMessage(alice.did, recordsQuery2.message);
        expect(reply2.entries?.length).to.equal(1);
        const reply2Attester = Jws.getSignerDid(reply2.entries![0].attestation!.signatures[0]);
        expect(reply2Attester).to.equal(bob.did);

        // testing attester filter that yields no results
        const carol = await TestDataGenerator.generateDidKeyPersona();
        const recordsQuery3 = await TestDataGenerator.generateRecordsQuery({ author: alice, filter: { attester: carol.did } });
        const reply3 = await dwn.processMessage(alice.did, recordsQuery3.message);
        expect(reply3.entries?.length).to.equal(0);
      });

      it('should be able to query by author', async () => {
        // scenario alice and bob both author records into alice's DWN.
        // alice is able to filter for records authored by bob.
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        const protocolDefinition = freeForAll;

        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          author: alice,
          protocolDefinition
        });
        const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
        expect(protocolsConfigureReply.status.code).to.equal(202);

        const aliceAuthorWrite = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : protocolDefinition.protocol,
          schema       : protocolDefinition.types.post.schema,
          dataFormat   : protocolDefinition.types.post.dataFormats[0],
          protocolPath : 'post'
        });
        const aliceAuthorReply = await dwn.processMessage(alice.did, aliceAuthorWrite.message, { dataStream: aliceAuthorWrite.dataStream });
        expect(aliceAuthorReply.status.code).to.equal(202);

        const bobAuthorWrite = await TestDataGenerator.generateRecordsWrite({
          author       : bob,
          protocol     : protocolDefinition.protocol,
          schema       : protocolDefinition.types.post.schema,
          dataFormat   : protocolDefinition.types.post.dataFormats[0],
          protocolPath : 'post'
        });
        const bobAuthorReply = await dwn.processMessage(alice.did, bobAuthorWrite.message, { dataStream: bobAuthorWrite.dataStream });
        expect(bobAuthorReply.status.code).to.equal(202);

        // alice queries with an empty filter, gets both
        let recordsQuery = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            protocol     : protocolDefinition.protocol,
            schema       : protocolDefinition.types.post.schema,
            dataFormat   : protocolDefinition.types.post.dataFormats[0],
            protocolPath : 'post'
          }
        });
        let queryReply = await dwn.processMessage(alice.did, recordsQuery.message);
        expect(queryReply.status.code).to.equal(200);
        expect(queryReply.entries?.length).to.equal(2);

        // filter for bob as author
        recordsQuery = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            author       : bob.did,
            protocol     : protocolDefinition.protocol,
            schema       : protocolDefinition.types.post.schema,
            dataFormat   : protocolDefinition.types.post.dataFormats[0],
            protocolPath : 'post'
          }
        });
        queryReply = await dwn.processMessage(alice.did, recordsQuery.message);
        expect(queryReply.status.code).to.equal(200);
        expect(queryReply.entries?.length).to.equal(1);
        expect(queryReply.entries![0].recordId).to.equal(bobAuthorWrite.message.recordId);
      });

      it('should be able to query for published records', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        // create a published record
        const publishedWrite = await TestDataGenerator.generateRecordsWrite({ author: alice, published: true, schema: 'post' });
        const publishedWriteReply = await dwn.processMessage(alice.did, publishedWrite.message, { dataStream: publishedWrite.dataStream });
        expect(publishedWriteReply.status.code).to.equal(202);

        // create an unpublished record
        const draftWrite = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'post' });
        const draftWriteReply = await dwn.processMessage(alice.did, draftWrite.message, { dataStream: draftWrite.dataStream });
        expect(draftWriteReply.status.code).to.equal(202);

        // query for only published records
        const publishedPostQuery = await TestDataGenerator.generateRecordsQuery({ author: alice, filter: { schema: 'post', published: true } });
        let publishedPostReply = await dwn.processMessage(alice.did, publishedPostQuery.message);
        expect(publishedPostReply.status.code).to.equal(200);
        expect(publishedPostReply.entries?.length).to.equal(1);
        expect(publishedPostReply.entries![0].recordId).to.equal(publishedWrite.message.recordId);

        // make an query for published records from non owner
        const notOwnerPostQuery = await TestDataGenerator.generateRecordsQuery({ author: bob, filter: { schema: 'post', published: true } });
        let notOwnerPublishedPostReply = await dwn.processMessage(alice.did, notOwnerPostQuery.message);
        expect(notOwnerPublishedPostReply.status.code).to.equal(200);
        expect(notOwnerPublishedPostReply.entries?.length).to.equal(1);
        expect(notOwnerPublishedPostReply.entries![0].recordId).to.equal(publishedWrite.message.recordId);

        // anonymous query for published records
        const anonymousPostQuery = await RecordsQuery.create({ filter: { schema: 'post', published: true } });
        let anonymousPublishedPostReply = await dwn.processMessage(alice.did, anonymousPostQuery.message);
        expect(anonymousPublishedPostReply.status.code).to.equal(200);
        expect(anonymousPublishedPostReply.entries?.length).to.equal(1);
        expect(anonymousPublishedPostReply.entries![0].recordId).to.equal(publishedWrite.message.recordId);

        // publish the unpublished record
        const publishedDraftWrite = await RecordsWrite.createFrom({
          recordsWriteMessage : draftWrite.message,
          published           : true,
          signer              : Jws.createSigner(alice)
        });
        const publishedDraftReply = await dwn.processMessage(alice.did, publishedDraftWrite.message);
        expect(publishedDraftReply.status.code).to.equal(202);

        // issue the same query for published records
        publishedPostReply = await dwn.processMessage(alice.did, publishedPostQuery.message);
        expect(publishedPostReply.status.code).to.equal(200);
        expect(publishedPostReply.entries?.length).to.equal(2);
        const returnedRecordIds = publishedPostReply.entries?.map(e => e.recordId);

        // ensure that both records now exist in results
        expect(returnedRecordIds).to.have.members([ publishedWrite.message.recordId, draftWrite.message.recordId ]);

        // query after publishing from non owner
        notOwnerPublishedPostReply = await dwn.processMessage(alice.did, anonymousPostQuery.message);
        expect(notOwnerPublishedPostReply.status.code).to.equal(200);
        expect(notOwnerPublishedPostReply.entries?.length).to.equal(2);
        const nonOwnerReturnedRecordIds = notOwnerPublishedPostReply.entries?.map(e => e.recordId);
        expect(nonOwnerReturnedRecordIds).to.have.members([ publishedWrite.message.recordId, draftWrite.message.recordId ]);

        // anonymous query after publishing
        anonymousPublishedPostReply = await dwn.processMessage(alice.did, anonymousPostQuery.message);
        expect(anonymousPublishedPostReply.status.code).to.equal(200);
        expect(anonymousPublishedPostReply.entries?.length).to.equal(2);
        const anonymousReturnedRecordIds = anonymousPublishedPostReply.entries?.map(e => e.recordId);
        expect(anonymousReturnedRecordIds).to.have.members([ publishedWrite.message.recordId, draftWrite.message.recordId ]);
      });

      it('should be able to query for unpublished records', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // create a published record
        const publishedWrite = await TestDataGenerator.generateRecordsWrite({ author: alice, published: true, schema: 'post' });
        const publishedWriteReply = await dwn.processMessage(alice.did, publishedWrite.message, { dataStream: publishedWrite.dataStream });
        expect(publishedWriteReply.status.code).to.equal(202);

        // create an unpublished record
        const draftWrite = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'post' });
        const draftWriteReply = await dwn.processMessage(alice.did, draftWrite.message, { dataStream: draftWrite.dataStream });
        expect(draftWriteReply.status.code).to.equal(202);

        // query for only unpublished records
        const unpublishedPostQuery = await TestDataGenerator.generateRecordsQuery({ author: alice, filter: { schema: 'post', published: false } });
        let unpublishedPostReply = await dwn.processMessage(alice.did, unpublishedPostQuery.message);
        expect(unpublishedPostReply.status.code).to.equal(200);
        expect(unpublishedPostReply.entries?.length).to.equal(1);
        expect(unpublishedPostReply.entries![0].recordId).to.equal(draftWrite.message.recordId);

        // publish the unpublished record
        const publishedDraftWrite = await RecordsWrite.createFrom({
          recordsWriteMessage : draftWrite.message,
          published           : true,
          signer              : Jws.createSigner(alice)
        });
        const publishedDraftReply = await dwn.processMessage(alice.did, publishedDraftWrite.message);
        expect(publishedDraftReply.status.code).to.equal(202);

        // issue the same query for unpublished records
        unpublishedPostReply = await dwn.processMessage(alice.did, unpublishedPostQuery.message);
        expect(unpublishedPostReply.status.code).to.equal(200);
        expect(unpublishedPostReply.entries?.length).to.equal(0);
      });

      it('should not be able to query for unpublished records if unauthorized', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        // create a published record
        const publishedWrite = await TestDataGenerator.generateRecordsWrite({ author: alice, published: true, schema: 'post' });
        const publishedWriteReply = await dwn.processMessage(alice.did, publishedWrite.message, { dataStream: publishedWrite.dataStream });
        expect(publishedWriteReply.status.code).to.equal(202);

        // create an unpublished record
        const draftWrite = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'post' });
        const draftWriteReply = await dwn.processMessage(alice.did, draftWrite.message, { dataStream: draftWrite.dataStream });
        expect(draftWriteReply.status.code).to.equal(202);

        // bob queries for unpublished records returns zero
        const unpublishedNotOwner = await TestDataGenerator.generateRecordsQuery({ author: bob, filter: { schema: 'post', published: false } });
        let notOwnerPostReply = await dwn.processMessage(alice.did, unpublishedNotOwner.message);
        expect(notOwnerPostReply.status.code).to.equal(200);
        expect(notOwnerPostReply.entries?.length).to.equal(0);

        // publish the unpublished record
        const publishedDraftWrite = await RecordsWrite.createFrom({
          recordsWriteMessage : draftWrite.message,
          published           : true,
          signer              : Jws.createSigner(alice)
        });
        const publishedDraftReply = await dwn.processMessage(alice.did, publishedDraftWrite.message);
        expect(publishedDraftReply.status.code).to.equal(202);

        // without published filter
        let publishedNotOwner = await TestDataGenerator.generateRecordsQuery({ author: bob, filter: { schema: 'post' } });
        let publishedNotOwnerReply = await dwn.processMessage(alice.did, publishedNotOwner.message);
        expect(publishedNotOwnerReply.status.code).to.equal(200);
        expect(publishedNotOwnerReply.entries?.length).to.equal(2);

        // with explicit published true
        publishedNotOwner = await TestDataGenerator.generateRecordsQuery({ author: bob, filter: { schema: 'post', published: true } });
        publishedNotOwnerReply = await dwn.processMessage(alice.did, publishedNotOwner.message);
        expect(publishedNotOwnerReply.status.code).to.equal(200);
        expect(publishedNotOwnerReply.entries?.length).to.equal(2);

        // with explicit published false after publishing should still return nothing
        notOwnerPostReply = await dwn.processMessage(alice.did, unpublishedNotOwner.message);
        expect(notOwnerPostReply.status.code).to.equal(200);
        expect(notOwnerPostReply.entries?.length).to.equal(0);
      });

      it('should be able to query for a record by a dataCid', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // create a record
        const writeRecord = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const writeRecordReply = await dwn.processMessage(alice.did, writeRecord.message, { dataStream: writeRecord.dataStream });
        expect(writeRecordReply.status.code).to.equal(202);
        const recordDataCid = writeRecord.message.descriptor.dataCid;

        // query for the record by it's dataCid
        const dataCidQuery = await TestDataGenerator.generateRecordsQuery({ author: alice, filter: { dataCid: recordDataCid } });
        const dataCidQueryReply = await dwn.processMessage(alice.did, dataCidQuery.message);
        expect(dataCidQueryReply.status.code).to.equal(200);
        expect(dataCidQueryReply.entries?.length).to.equal(1);
        expect(dataCidQueryReply.entries![0].recordId).to.equal(writeRecord.message.recordId);
      });

      it('should be able to query with `dataSize` filter (half-open range)', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const write1 = await TestDataGenerator.generateRecordsWrite({ author: alice, data: TestDataGenerator.randomBytes(10) });
        const write2 = await TestDataGenerator.generateRecordsWrite({ author: alice, data: TestDataGenerator.randomBytes(50) });
        const write3 = await TestDataGenerator.generateRecordsWrite({ author: alice, data: TestDataGenerator.randomBytes(100) });

        // insert data
        const writeReply1 = await dwn.processMessage(alice.did, write1.message, { dataStream: write1.dataStream });
        const writeReply2 = await dwn.processMessage(alice.did, write2.message, { dataStream: write2.dataStream });
        const writeReply3 = await dwn.processMessage(alice.did, write3.message, { dataStream: write3.dataStream });
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
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const write1 = await TestDataGenerator.generateRecordsWrite({ author: alice, data: TestDataGenerator.randomBytes(10) });
        const write2 = await TestDataGenerator.generateRecordsWrite({ author: alice, data: TestDataGenerator.randomBytes(50) });
        const write3 = await TestDataGenerator.generateRecordsWrite({ author: alice, data: TestDataGenerator.randomBytes(100) });

        // insert data
        const writeReply1 = await dwn.processMessage(alice.did, write1.message, { dataStream: write1.dataStream });
        const writeReply2 = await dwn.processMessage(alice.did, write2.message, { dataStream: write2.dataStream });
        const writeReply3 = await dwn.processMessage(alice.did, write3.message, { dataStream: write3.dataStream });
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
        // scenario: 3 records authored by alice, created on first of 2021, 2022, and 2023 respectively
        // only the first 2 records share the same schema
        const firstDayOf2021 = Time.createTimestamp({ year: 2021, month: 1, day: 1 });
        const firstDayOf2022 = Time.createTimestamp({ year: 2022, month: 1, day: 1 });
        const firstDayOf2023 = Time.createTimestamp({ year: 2023, month: 1, day: 1 });
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const write1 = await TestDataGenerator.generateRecordsWrite({ author: alice, dateCreated: firstDayOf2021, messageTimestamp: firstDayOf2021 });
        const write2 = await TestDataGenerator.generateRecordsWrite({ author: alice, dateCreated: firstDayOf2022, messageTimestamp: firstDayOf2022 });
        const write3 = await TestDataGenerator.generateRecordsWrite({ author: alice, dateCreated: firstDayOf2023, messageTimestamp: firstDayOf2023 });

        // insert data
        const writeReply1 = await dwn.processMessage(alice.did, write1.message, { dataStream: write1.dataStream });
        const writeReply2 = await dwn.processMessage(alice.did, write2.message, { dataStream: write2.dataStream });
        const writeReply3 = await dwn.processMessage(alice.did, write3.message, { dataStream: write3.dataStream });
        expect(writeReply1.status.code).to.equal(202);
        expect(writeReply2.status.code).to.equal(202);
        expect(writeReply3.status.code).to.equal(202);

        // testing `from` range
        const lastDayOf2021 = Time.createTimestamp({ year: 2021, month: 12, day: 31 });
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
        const lastDayOf2022 = Time.createTimestamp({ year: 2022, month: 12, day: 31 });
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
        const lastDayOf2023 = Time.createTimestamp({ year: 2023, month: 12, day: 31 });
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

      it('should not return records that were published and then unpublished ', async () => {
        // scenario: 3 records authored by alice, published on first of 2021, 2022, and 2023 respectively
        // then the records are unpublished and tested to not return when filtering for published records

        const firstDayOf2020 = Time.createTimestamp({ year: 2020, month: 1, day: 1 });
        const firstDayOf2021 = Time.createTimestamp({ year: 2021, month: 1, day: 1 });
        const firstDayOf2022 = Time.createTimestamp({ year: 2022, month: 1, day: 1 });
        const firstDayOf2023 = Time.createTimestamp({ year: 2023, month: 1, day: 1 });
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const write1 = await TestDataGenerator.generateRecordsWrite({
          author: alice, published: true, dateCreated: firstDayOf2020, datePublished: firstDayOf2021, messageTimestamp: firstDayOf2020
        });
        const write2 = await TestDataGenerator.generateRecordsWrite({
          author: alice, published: true, dateCreated: firstDayOf2020, datePublished: firstDayOf2022, messageTimestamp: firstDayOf2020
        });
        const write3 = await TestDataGenerator.generateRecordsWrite({
          author: alice, published: true, dateCreated: firstDayOf2020, datePublished: firstDayOf2023, messageTimestamp: firstDayOf2020
        });

        // insert data
        const writeReply1 = await dwn.processMessage(alice.did, write1.message, { dataStream: write1.dataStream });
        const writeReply2 = await dwn.processMessage(alice.did, write2.message, { dataStream: write2.dataStream });
        const writeReply3 = await dwn.processMessage(alice.did, write3.message, { dataStream: write3.dataStream });
        expect(writeReply1.status.code).to.equal(202);
        expect(writeReply2.status.code).to.equal(202);
        expect(writeReply3.status.code).to.equal(202);

        // confirm range before un-publishing.
        const lastDayOf2021 = Time.createTimestamp({ year: 2021, month: 12, day: 31 });
        const ownerRangeQuery = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          filter   : { datePublished: { from: lastDayOf2021 } },
          dateSort : DateSort.CreatedAscending
        });
        const reply1 = await dwn.processMessage(alice.did, ownerRangeQuery.message);
        expect(reply1.entries?.length).to.equal(2);
        const reply1RecordIds = reply1.entries?.map(e => e.recordId);
        expect(reply1RecordIds).to.have.members([ write2.message.recordId, write3.message.recordId ]);

        // confirm published true filter before un-publishing
        const ownerPublishedQuery = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          filter   : { published: true },
          dateSort : DateSort.CreatedAscending
        });
        let ownerPublishedReply = await dwn.processMessage(alice.did, ownerPublishedQuery.message);
        expect(ownerPublishedReply.status.code).to.equal(200);
        expect(ownerPublishedReply.entries?.length).to.equal(3);
        const ownerPublishedIds = ownerPublishedReply.entries?.map(e => e.recordId);
        expect(ownerPublishedIds).to.have.members([ write1.message.recordId, write2.message.recordId, write3.message.recordId ]);

        // confirm for anonymous query before un-publishing
        const anonymousRangeQuery = await RecordsQuery.create({
          filter   : { datePublished: { from: lastDayOf2021 } },
          dateSort : DateSort.CreatedAscending
        });

        let anonymousRangeReply = await dwn.processMessage(alice.did, anonymousRangeQuery.message);
        expect(anonymousRangeReply.status.code).to.equal(200);
        expect(anonymousRangeReply.entries?.length).to.equal(2);
        const anonymousReplyIds = anonymousRangeReply.entries?.map(e => e.recordId);
        expect(anonymousReplyIds).to.have.members([ write2.message.recordId, write3.message.recordId ]);

        // confirm anonymous published true filter before un-publishing
        const anonymousPublishedQuery = await RecordsQuery.create({
          filter   : { published: true },
          dateSort : DateSort.CreatedAscending
        });
        let anonymousPublishedReply = await dwn.processMessage(alice.did, anonymousPublishedQuery.message);
        expect(anonymousPublishedReply.status.code).to.equal(200);
        expect(anonymousPublishedReply.entries?.length).to.equal(3);
        const anonymousPublishedIds = anonymousPublishedReply.entries?.map(e => e.recordId);
        expect(anonymousPublishedIds).to.have.members([ write1.message.recordId, write2.message.recordId, write3.message.recordId ]);

        //unpublish records
        const write1Unpublish = await RecordsWrite.createFrom({
          signer              : Jws.createSigner(alice),
          recordsWriteMessage : write1.message,
          published           : false
        });
        const write2Unpublish = await RecordsWrite.createFrom({
          signer              : Jws.createSigner(alice),
          recordsWriteMessage : write2.message,
          published           : false
        });
        const write3Unpublish = await RecordsWrite.createFrom({
          signer              : Jws.createSigner(alice),
          recordsWriteMessage : write3.message,
          published           : false
        });
        const unpublished1Response = await dwn.processMessage(alice.did, write1Unpublish.message);
        const unpublished2Response = await dwn.processMessage(alice.did, write2Unpublish.message);
        const unpublished3Response = await dwn.processMessage(alice.did, write3Unpublish.message);
        expect(unpublished1Response.status.code).to.equal(202);
        expect(unpublished2Response.status.code).to.equal(202);
        expect(unpublished3Response.status.code).to.equal(202);

        // try datePublished range query as an anonymous user after unpublish
        anonymousRangeReply = await dwn.processMessage(alice.did, anonymousRangeQuery.message);
        expect(anonymousRangeReply.status.code).to.equal(200);
        expect(anonymousRangeReply.entries?.length).to.equal(0);

        // try published:true filter as an anonymous user after unpublish
        anonymousPublishedReply = await dwn.processMessage(alice.did, anonymousPublishedQuery.message);
        expect(anonymousPublishedReply.status.code).to.equal(200);
        expect(anonymousPublishedReply.entries?.length).to.equal(0);

        // try datePublished range query as owner after unpublish
        const ownerRangeReply = await dwn.processMessage(alice.did, ownerRangeQuery.message);
        expect(ownerRangeReply.status.code).to.equal(200);
        expect(ownerRangeReply.entries?.length).to.equal(0);

        // try published:true filter as owner after unpublish
        ownerPublishedReply = await dwn.processMessage(alice.did, ownerPublishedQuery.message);
        expect(ownerPublishedReply.status.code).to.equal(200);
        expect(ownerPublishedReply.entries?.length).to.equal(0);
      });

      it('should be able to range query by `datePublished`', async () => {
        // scenario: 3 records authored by alice, published on first of 2021, 2022, and 2023 respectively
        // all 3 records are created on first of 2020

        const firstDayOf2020 = Time.createTimestamp({ year: 2020, month: 1, day: 1 });
        const firstDayOf2021 = Time.createTimestamp({ year: 2021, month: 1, day: 1 });
        const firstDayOf2022 = Time.createTimestamp({ year: 2022, month: 1, day: 1 });
        const firstDayOf2023 = Time.createTimestamp({ year: 2023, month: 1, day: 1 });
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const write1 = await TestDataGenerator.generateRecordsWrite({
          author: alice, published: true, dateCreated: firstDayOf2020, datePublished: firstDayOf2021, messageTimestamp: firstDayOf2020
        });
        const write2 = await TestDataGenerator.generateRecordsWrite({
          author: alice, published: true, dateCreated: firstDayOf2020, datePublished: firstDayOf2022, messageTimestamp: firstDayOf2020
        });
        const write3 = await TestDataGenerator.generateRecordsWrite({
          author: alice, published: true, dateCreated: firstDayOf2020, datePublished: firstDayOf2023, messageTimestamp: firstDayOf2020
        });

        // insert data
        const writeReply1 = await dwn.processMessage(alice.did, write1.message, { dataStream: write1.dataStream });
        const writeReply2 = await dwn.processMessage(alice.did, write2.message, { dataStream: write2.dataStream });
        const writeReply3 = await dwn.processMessage(alice.did, write3.message, { dataStream: write3.dataStream });
        expect(writeReply1.status.code).to.equal(202);
        expect(writeReply2.status.code).to.equal(202);
        expect(writeReply3.status.code).to.equal(202);

        // testing `from` range
        const lastDayOf2021 = Time.createTimestamp({ year: 2021, month: 12, day: 31 });
        const recordsQuery1 = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          filter   : { datePublished: { from: lastDayOf2021 } },
          dateSort : DateSort.CreatedAscending
        });
        const reply1 = await dwn.processMessage(alice.did, recordsQuery1.message);
        expect(reply1.entries?.length).to.equal(2);
        const reply1RecordIds = reply1.entries?.map(e => e.recordId);
        expect(reply1RecordIds).to.have.members([ write2.message.recordId, write3.message.recordId ]);

        // testing `to` range
        const lastDayOf2022 = Time.createTimestamp({ year: 2022, month: 12, day: 31 });
        const recordsQuery2 = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          filter   : { datePublished: { to: lastDayOf2022 } },
          dateSort : DateSort.CreatedAscending
        });
        const reply2 = await dwn.processMessage(alice.did, recordsQuery2.message);
        expect(reply2.entries?.length).to.equal(2);
        const reply2RecordIds = reply2.entries?.map(e => e.recordId);
        expect(reply2RecordIds).to.have.members([ write1.message.recordId, write2.message.recordId ]);

        // testing `from` and `to` range
        const lastDayOf2023 = Time.createTimestamp({ year: 2023, month: 12, day: 31 });
        const recordsQuery3 = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          filter   : { datePublished: { from: lastDayOf2022, to: lastDayOf2023 } },
          dateSort : DateSort.CreatedAscending
        });
        const reply3 = await dwn.processMessage(alice.did, recordsQuery3.message);
        expect(reply3.entries?.length).to.equal(1);
        expect(reply3.entries![0].recordId).to.equal(write3.message.recordId);

        // testing edge case where value equals `from` and `to`
        const recordsQuery4 = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          filter   : { datePublished: { from: firstDayOf2022, to: firstDayOf2023 } },
          dateSort : DateSort.CreatedAscending
        });
        const reply4 = await dwn.processMessage(alice.did, recordsQuery4.message);
        expect(reply4.entries?.length).to.equal(1);
        expect(reply4.entries![0].recordId).to.equal(write2.message.recordId);

        // check for anonymous range query
        const anonymousRecordQuery = await RecordsQuery.create({
          filter   : { datePublished: { from: lastDayOf2021 } },
          dateSort : DateSort.CreatedAscending
        });

        const anonymousReply = await dwn.processMessage(alice.did, anonymousRecordQuery.message);
        expect(anonymousReply.status.code).to.equal(200);
        expect(anonymousReply.entries?.length).to.equal(2);
        const anonymousReplyIds = anonymousReply.entries?.map(e => e.recordId);
        expect(anonymousReplyIds).to.have.members([ write2.message.recordId, write3.message.recordId ]);

        // check for non owner range query
        const bob = await TestDataGenerator.generateDidKeyPersona();
        const nonOwnerRange = await TestDataGenerator.generateRecordsQuery({
          author   : bob,
          filter   : { datePublished: { from: lastDayOf2021 } },
          dateSort : DateSort.CreatedAscending
        });

        const nonOwnerReply = await dwn.processMessage(alice.did, nonOwnerRange.message);
        expect(nonOwnerReply.status.code).to.equal(200);
        expect(nonOwnerReply.entries?.length).to.equal(2);
        const nonOwnerReplyIds = nonOwnerReply.entries?.map(e => e.recordId);
        expect(nonOwnerReplyIds).to.have.members([ write2.message.recordId, write3.message.recordId ]);
      });

      it('should be able to range query by `dateUpdated`', async () => {
        // scenario: alice creates 3 records on the first day of 2020.
        // alice then updates these records to published on first of 2021, 2022, and 2023 respectively
        // this should update the messageTimestamp on the respective messages

        const firstDayOf2020 = Time.createTimestamp({ year: 2020, month: 1, day: 1 });
        const firstDayOf2021 = Time.createTimestamp({ year: 2021, month: 1, day: 1 });
        const firstDayOf2022 = Time.createTimestamp({ year: 2022, month: 1, day: 1 });
        const firstDayOf2023 = Time.createTimestamp({ year: 2023, month: 1, day: 1 });
        const alice = await TestDataGenerator.generateDidKeyPersona();

        const write1 = await TestDataGenerator.generateRecordsWrite({
          author: alice, dateCreated: firstDayOf2020, messageTimestamp: firstDayOf2020
        });
        const write2 = await TestDataGenerator.generateRecordsWrite({
          author: alice, dateCreated: firstDayOf2020, messageTimestamp: firstDayOf2020
        });
        const write3 = await TestDataGenerator.generateRecordsWrite({
          author: alice, dateCreated: firstDayOf2020, messageTimestamp: firstDayOf2020
        });

        // insert data
        const writeReply1 = await dwn.processMessage(alice.did, write1.message, { dataStream: write1.dataStream });
        const writeReply2 = await dwn.processMessage(alice.did, write2.message, { dataStream: write2.dataStream });
        const writeReply3 = await dwn.processMessage(alice.did, write3.message, { dataStream: write3.dataStream });
        expect(writeReply1.status.code).to.equal(202);
        expect(writeReply2.status.code).to.equal(202);
        expect(writeReply3.status.code).to.equal(202);

        // update to published
        const write1Update = await RecordsWrite.createFrom({
          recordsWriteMessage : write1.message,
          published           : true,
          messageTimestamp    : firstDayOf2021,
          datePublished       : firstDayOf2021,
          signer              : Jws.createSigner(alice)
        });

        const write2Update = await RecordsWrite.createFrom({
          recordsWriteMessage : write2.message,
          published           : true,
          messageTimestamp    : firstDayOf2022,
          datePublished       : firstDayOf2022,
          signer              : Jws.createSigner(alice)
        });

        const write3Update = await RecordsWrite.createFrom({
          recordsWriteMessage : write3.message,
          published           : true,
          messageTimestamp    : firstDayOf2023,
          datePublished       : firstDayOf2023,
          signer              : Jws.createSigner(alice)
        });
        const writeReplyUpdate1 = await dwn.processMessage(alice.did, write1Update.message);
        const writeReplyUpdate2 = await dwn.processMessage(alice.did, write2Update.message);
        const writeReplyUpdate3 = await dwn.processMessage(alice.did, write3Update.message);
        expect(writeReplyUpdate1.status.code).to.equal(202);
        expect(writeReplyUpdate2.status.code).to.equal(202);
        expect(writeReplyUpdate3.status.code).to.equal(202);

        // testing `from` range
        const lastDayOf2021 = Time.createTimestamp({ year: 2021, month: 12, day: 31 });
        const recordsQuery1 = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          filter   : { dateUpdated: { from: lastDayOf2021 } },
          dateSort : DateSort.CreatedAscending
        });
        const reply1 = await dwn.processMessage(alice.did, recordsQuery1.message);
        expect(reply1.entries?.length).to.equal(2);
        const reply1RecordIds = reply1.entries?.map(e => e.recordId);
        expect(reply1RecordIds).to.have.members([ write2.message.recordId, write3.message.recordId ]);

        // testing `to` range
        const lastDayOf2022 = Time.createTimestamp({ year: 2022, month: 12, day: 31 });
        const recordsQuery2 = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          filter   : { dateUpdated: { to: lastDayOf2022 } },
          dateSort : DateSort.CreatedAscending
        });
        const reply2 = await dwn.processMessage(alice.did, recordsQuery2.message);
        expect(reply2.entries?.length).to.equal(2);
        const reply2RecordIds = reply2.entries?.map(e => e.recordId);
        expect(reply2RecordIds).to.have.members([ write1.message.recordId, write2.message.recordId ]);

        // testing `from` and `to` range
        const lastDayOf2023 = Time.createTimestamp({ year: 2023, month: 12, day: 31 });
        const recordsQuery3 = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          filter   : { dateUpdated: { from: lastDayOf2022, to: lastDayOf2023 } },
          dateSort : DateSort.CreatedAscending
        });
        const reply3 = await dwn.processMessage(alice.did, recordsQuery3.message);
        expect(reply3.entries?.length).to.equal(1);
        expect(reply3.entries![0].recordId).to.equal(write3.message.recordId);

        // testing edge case where value equals `from` and `to`
        const recordsQuery4 = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          filter   : { dateUpdated: { from: firstDayOf2022, to: firstDayOf2023 } },
          dateSort : DateSort.CreatedAscending
        });
        const reply4 = await dwn.processMessage(alice.did, recordsQuery4.message);
        expect(reply4.entries?.length).to.equal(1);
        expect(reply4.entries![0].recordId).to.equal(write2.message.recordId);
      });

      it('should be able use range and exact match queries at the same time', async () => {
        // scenario: 3 records authored by alice, created on first of 2021, 2022, and 2023 respectively
        // only the first 2 records share the same schema
        const firstDayOf2021 = Time.createTimestamp({ year: 2021, month: 1, day: 1 });
        const firstDayOf2022 = Time.createTimestamp({ year: 2022, month: 1, day: 1 });
        const firstDayOf2023 = Time.createTimestamp({ year: 2023, month: 1, day: 1 });
        const alice = await TestDataGenerator.generateDidKeyPersona();
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
        const writeReply1 = await dwn.processMessage(alice.did, write1.message, { dataStream: write1.dataStream });
        const writeReply2 = await dwn.processMessage(alice.did, write2.message, { dataStream: write2.dataStream });
        const writeReply3 = await dwn.processMessage(alice.did, write3.message, { dataStream: write3.dataStream });
        expect(writeReply1.status.code).to.equal(202);
        expect(writeReply2.status.code).to.equal(202);
        expect(writeReply3.status.code).to.equal(202);

        // testing range criterion with another exact match
        const lastDayOf2021 = Time.createTimestamp({ year: 2021, month: 12, day: 31 });
        const lastDayOf2023 = Time.createTimestamp({ year: 2023, month: 12, day: 31 });
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

        const writeReply = await dwn.processMessage(alice.did, message, { dataStream });
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

        const alice = await TestDataGenerator.generateDidKeyPersona();
        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice, attesters: [alice] });

        const writeReply = await dwn.processMessage(alice.did, message, { dataStream });
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
        const publishedWriteReply = await dwn.processMessage(alice.did, publishedWriteData.message, { dataStream: publishedWriteData.dataStream });
        const unpublishedWriteReply =
          await dwn.processMessage(alice.did, unpublishedWriteData.message, { dataStream: unpublishedWriteData.dataStream });
        expect(publishedWriteReply.status.code).to.equal(202);
        expect(unpublishedWriteReply.status.code).to.equal(202);

        // test published date ascending sort does not include any records that are not published
        const publishedAscendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          dateSort : DateSort.PublishedAscending,
          filter   : { schema }
        });
        const publishedAscendingQueryReply = await dwn.processMessage(alice.did, publishedAscendingQueryData.message);
        expect(publishedAscendingQueryReply.entries?.length).to.equal(1);
        expect(publishedAscendingQueryReply.entries![0].recordId).to.equal(publishedWriteData.message.recordId);

        // test published date scending sort does not include any records that are not published
        const publishedDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          dateSort : DateSort.PublishedDescending,
          filter   : { schema }
        });
        const publishedDescendingQueryReply = await dwn.processMessage(alice.did, publishedDescendingQueryData.message);
        expect(publishedDescendingQueryReply.entries?.length).to.equal(1);
        expect(publishedDescendingQueryReply.entries![0].recordId).to.equal(publishedWriteData.message.recordId);
      });

      it('should sort records if `dateSort` is specified with and without a cursor', async () => {
        // insert three messages into DB
        const alice = await TestDataGenerator.generatePersona();
        const schema = 'aSchema';
        const published = true;
        const write1Data = await TestDataGenerator.generateRecordsWrite({ author: alice, schema, published });
        await Time.minimalSleep();
        const write2Data = await TestDataGenerator.generateRecordsWrite({ author: alice, schema, published });
        await Time.minimalSleep();
        const write3Data = await TestDataGenerator.generateRecordsWrite({ author: alice, schema, published });

        // setting up a stub method resolver
        const mockResolution = TestDataGenerator.createDidResolutionResult(alice);;
        sinon.stub(didResolver, 'resolve').resolves(mockResolution);

        // insert data, intentionally out of order
        const writeReply2 = await dwn.processMessage(alice.did, write2Data.message, { dataStream: write2Data.dataStream });
        const writeReply1 = await dwn.processMessage(alice.did, write1Data.message, { dataStream: write1Data.dataStream });
        const writeReply3 = await dwn.processMessage(alice.did, write3Data.message, { dataStream: write3Data.dataStream });
        expect(writeReply1.status.code).to.equal(202);
        expect(writeReply2.status.code).to.equal(202);
        expect(writeReply3.status.code).to.equal(202);

        // createdAscending test
        let createdAscendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          dateSort : DateSort.CreatedAscending,
          filter   : { schema }
        });
        let createdAscendingQueryReply = await dwn.processMessage(alice.did, createdAscendingQueryData.message);
        expect(createdAscendingQueryReply.entries!.length).to.equal(3);
        expect(createdAscendingQueryReply.entries?.[0].recordId).to.equal(write1Data.message.recordId);
        expect(createdAscendingQueryReply.entries?.[1].recordId).to.equal(write2Data.message.recordId);
        expect(createdAscendingQueryReply.entries?.[2].recordId).to.equal(write3Data.message.recordId);

        // to test with a cursor we first get a single record
        createdAscendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author     : alice,
          dateSort   : DateSort.CreatedAscending,
          filter     : { schema },
          pagination : { limit: 1 }
        });
        createdAscendingQueryReply = await dwn.processMessage(alice.did, createdAscendingQueryData.message);
        expect(createdAscendingQueryReply.entries!.length).to.equal(1);

        // we then use the single record query's cursor to get the rest of the records
        createdAscendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author     : alice,
          dateSort   : DateSort.CreatedAscending,
          filter     : { schema },
          pagination : { cursor: createdAscendingQueryReply.cursor }
        });
        createdAscendingQueryReply = await dwn.processMessage(alice.did, createdAscendingQueryData.message);
        expect(createdAscendingQueryReply.entries!.length).to.equal(2);
        expect(createdAscendingQueryReply.entries![0].recordId).to.equal(write2Data.message.recordId);
        expect(createdAscendingQueryReply.entries![1].recordId).to.equal(write3Data.message.recordId);

        // createdDescending test
        let createdDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          dateSort : DateSort.CreatedDescending,
          filter   : { schema }
        });
        let createdDescendingQueryReply = await dwn.processMessage(alice.did, createdDescendingQueryData.message);
        expect(createdDescendingQueryReply.entries!.length).to.equal(3);
        expect(createdDescendingQueryReply.entries?.[0].recordId).to.equal(write3Data.message.recordId);
        expect(createdDescendingQueryReply.entries?.[1].recordId).to.equal(write2Data.message.recordId);
        expect(createdDescendingQueryReply.entries?.[2].recordId).to.equal(write1Data.message.recordId);

        // to test with a cursor we first get a single record
        createdDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author     : alice,
          dateSort   : DateSort.CreatedDescending,
          filter     : { schema },
          pagination : { limit: 1 }
        });
        createdDescendingQueryReply = await dwn.processMessage(alice.did, createdDescendingQueryData.message);
        expect(createdDescendingQueryReply.entries!.length).to.equal(1);

        // we then use the single record query's cursor to get the rest of the records
        createdDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author     : alice,
          dateSort   : DateSort.CreatedDescending,
          filter     : { schema },
          pagination : { cursor: createdDescendingQueryReply.cursor }
        });
        createdDescendingQueryReply = await dwn.processMessage(alice.did, createdDescendingQueryData.message);
        expect(createdDescendingQueryReply.entries!.length).to.equal(2);
        expect(createdDescendingQueryReply.entries![0].recordId).to.equal(write2Data.message.recordId);
        expect(createdDescendingQueryReply.entries![1].recordId).to.equal(write1Data.message.recordId);

        // publishedAscending test
        let publishedAscendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          dateSort : DateSort.PublishedAscending,
          filter   : { schema }
        });
        let publishedAscendingQueryReply = await dwn.processMessage(alice.did, publishedAscendingQueryData.message);
        expect(publishedAscendingQueryReply.entries!.length).to.equal(3);
        expect(publishedAscendingQueryReply.entries?.[0].recordId).to.equal(write1Data.message.recordId);
        expect(publishedAscendingQueryReply.entries?.[1].recordId).to.equal(write2Data.message.recordId);
        expect(publishedAscendingQueryReply.entries?.[2].recordId).to.equal(write3Data.message.recordId);

        // to test with a cursor we first get a single record
        publishedAscendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author     : alice,
          dateSort   : DateSort.PublishedAscending,
          filter     : { schema },
          pagination : { limit: 1 }
        });
        publishedAscendingQueryReply = await dwn.processMessage(alice.did, publishedAscendingQueryData.message);
        expect(publishedAscendingQueryReply.entries!.length).to.equal(1);

        publishedAscendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author     : alice,
          dateSort   : DateSort.PublishedAscending,
          filter     : { schema },
          pagination : { cursor: publishedAscendingQueryReply.cursor }
        });
        publishedAscendingQueryReply = await dwn.processMessage(alice.did, publishedAscendingQueryData.message);
        expect(publishedAscendingQueryReply.entries!.length).to.equal(2);
        expect(publishedAscendingQueryReply.entries![0].recordId).to.equal(write2Data.message.recordId);
        expect(publishedAscendingQueryReply.entries![1].recordId).to.equal(write3Data.message.recordId);

        // publishedDescending test
        let publishedDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          dateSort : DateSort.PublishedDescending,
          filter   : { schema }
        });
        let publishedDescendingQueryReply = await dwn.processMessage(alice.did, publishedDescendingQueryData.message);
        expect(publishedDescendingQueryReply.entries!.length).to.equal(3);
        expect(publishedDescendingQueryReply.entries?.[0].recordId).to.equal(write3Data.message.recordId);
        expect(publishedDescendingQueryReply.entries?.[1].recordId).to.equal(write2Data.message.recordId);
        expect(publishedDescendingQueryReply.entries?.[2].recordId).to.equal(write1Data.message.recordId);

        publishedDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author     : alice,
          dateSort   : DateSort.PublishedDescending,
          filter     : { schema },
          pagination : { limit: 1 }
        });
        publishedDescendingQueryReply = await dwn.processMessage(alice.did, publishedDescendingQueryData.message);
        expect(publishedDescendingQueryReply.entries!.length).to.equal(1);

        publishedDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
          author     : alice,
          dateSort   : DateSort.PublishedDescending,
          filter     : { schema },
          pagination : { cursor: publishedDescendingQueryReply.cursor }
        });
        publishedDescendingQueryReply = await dwn.processMessage(alice.did, publishedDescendingQueryData.message);
        expect(publishedDescendingQueryReply.entries!.length).to.equal(2);
        expect(publishedDescendingQueryReply.entries![0].recordId).to.equal(write2Data.message.recordId);
        expect(publishedDescendingQueryReply.entries![1].recordId).to.equal(write1Data.message.recordId);
      });

      it('should tiebreak using `messageCid` when sorting encounters identical values', async () => {
        // setup: 3 messages with the same `dateCreated` value
        const dateCreated = Time.getCurrentTimestamp();
        const messageTimestamp = dateCreated;
        const alice = await TestDataGenerator.generateDidKeyPersona();
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
        const reply2 = await dwn.processMessage(alice.did, middleWrite.message, { dataStream: middleWrite.dataStream });
        expect(reply2.status.code).to.equal(202);
        const reply3 = await dwn.processMessage(alice.did, newestWrite.message, { dataStream: newestWrite.dataStream });
        expect(reply3.status.code).to.equal(202);
        const reply1 = await dwn.processMessage(alice.did, oldestWrite.message, { dataStream: oldestWrite.dataStream });
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
        expect((queryReply.entries![0]).recordId).to.equal(oldestWrite.message.recordId);
        expect((queryReply.entries![1]).recordId).to.equal(middleWrite.message.recordId);
        expect((queryReply.entries![2]).recordId).to.equal(newestWrite.message.recordId);

        // sort descending should be reversed
        const queryMessageDescending = await TestDataGenerator.generateRecordsQuery({
          author   : alice,
          filter   : { schema },
          dateSort : DateSort.CreatedDescending
        });
        const descendingReply = await dwn.processMessage(alice.did, queryMessageDescending.message);
        expect((descendingReply.entries![0]).recordId).to.equal(newestWrite.message.recordId);
        expect((descendingReply.entries![1]).recordId).to.equal(middleWrite.message.recordId);
        expect((descendingReply.entries![2]).recordId).to.equal(oldestWrite.message.recordId);
      });

      it('should paginate all records in ascending order', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        const messages = await Promise.all(Array(12).fill({}).map(_ => TestDataGenerator.generateRecordsWrite({
          author : alice,
          schema : 'https://schema'
        })));
        for (const message of messages) {
          const result = await dwn.processMessage(alice.did, message.message, { dataStream: message.dataStream });
          expect(result.status.code).to.equal(202);
        }

        const limit = 5;
        const results: RecordsQueryReplyEntry[] = [];
        let cursor;
        while (true) {
          const pageQuery = await TestDataGenerator.generateRecordsQuery({
            author : alice,
            filter : {
              schema: 'https://schema'
            },
            pagination: {
              limit: limit,
              cursor,
            },
            dateSort: DateSort.CreatedAscending
          });

          const pageReply = await dwn.processMessage(alice.did, pageQuery.message);
          expect(pageReply.status.code).to.equal(200);
          cursor = pageReply.cursor;
          expect(pageReply.entries?.length).to.be.lte(limit);
          results.push(...pageReply.entries!);
          if (cursor === undefined) {
            break;
          }
        }
        expect(results.length).to.equal(messages.length);
        expect(messages.every(({ message }) => results.map(e => (e as RecordsWriteMessage).recordId).includes(message.recordId)));
      });

      it('should paginate all records in descending order', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        const messages = await Promise.all(Array(12).fill({}).map(_ => TestDataGenerator.generateRecordsWrite({
          author : alice,
          schema : 'https://schema'
        })));
        for (const message of messages) {
          const result = await dwn.processMessage(alice.did, message.message, { dataStream: message.dataStream });
          expect(result.status.code).to.equal(202);
        }

        const limit = 5;
        const results: RecordsQueryReplyEntry[] = [];
        let cursor;
        while (true) {
          const pageQuery = await TestDataGenerator.generateRecordsQuery({
            author : alice,
            filter : {
              schema: 'https://schema'
            },
            pagination: {
              limit: limit,
              cursor,
            },
            dateSort: DateSort.CreatedDescending,
          });

          const pageReply = await dwn.processMessage(alice.did, pageQuery.message);
          expect(pageReply.status.code).to.equal(200);
          cursor = pageReply.cursor;
          expect(pageReply.entries?.length).to.be.lte(limit);
          results.push(...pageReply.entries!);
          if (cursor === undefined) {
            break;
          }
        }
        expect(results.length).to.equal(messages.length);
        expect(messages.every(({ message }) => results.map(e => (e as RecordsWriteMessage).recordId).includes(message.recordId)));
      });

      it('should allow an anonymous unauthenticated query to return published records', async () => {
      // write 2 records into Alice's DB:
      // 1st is unpublished
      // 2nd is published
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const record1Data = await TestDataGenerator.generateRecordsWrite(
          { author: alice, schema: 'https://schema1', published: false }
        );
        const record2Data = await TestDataGenerator.generateRecordsWrite(
          { author: alice, schema: 'https://schema2', published: true }
        );

        const recordsWrite1Reply = await dwn.processMessage(alice.did, record1Data.message, { dataStream: record1Data.dataStream });
        expect(recordsWrite1Reply.status.code).to.equal(202);
        const recordsWrite2Reply = await dwn.processMessage(alice.did, record2Data.message, { dataStream: record2Data.dataStream });
        expect(recordsWrite2Reply.status.code).to.equal(202);

        // test correctness for anonymous query
        const anonymousQueryMessageData = await TestDataGenerator.generateRecordsQuery({
          anonymous : true,
          filter    : { dateCreated: { from: '2000-01-01T10:20:30.123456Z' } }
        });

        // sanity check
        expect(anonymousQueryMessageData.message.authorization).to.not.exist;

        const replyToQuery = await dwn.processMessage(alice.did, anonymousQueryMessageData.message);

        expect(replyToQuery.status.code).to.equal(200);
        expect(replyToQuery.entries?.length).to.equal(1);
        expect((replyToQuery.entries![0].descriptor as RecordsWriteDescriptor).schema).to.equal('https://schema2');

        // explicitly for published records
        const anonymousQueryPublished = await TestDataGenerator.generateRecordsQuery({
          anonymous : true,
          filter    : { dateCreated: { from: '2000-01-01T10:20:30.123456Z' }, published: true }
        });
        // sanity check
        expect(anonymousQueryPublished.message.authorization).to.not.exist;

        // should return the published records
        const publishedReply = await dwn.processMessage(alice.did, anonymousQueryPublished.message);
        expect(publishedReply.status.code).to.equal(200);
        expect(publishedReply.entries?.length).to.equal(1);
        expect((publishedReply.entries![0].descriptor as RecordsWriteDescriptor).schema).to.equal('https://schema2');
      });

      it('should only return published records and unpublished records that is meant for author', async () => {
      // write 4 records into Alice's DB:
      // 1st is unpublished authored by Alice
      // 2nd is also unpublished authored by Alice, but is meant for (has recipient as) Bob
      // 3rd is also unpublished but is authored by Bob
      // 4th is published
      // 5th is published, authored by Alice and is meant for Carol as recipient;

        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();
        const carol = await TestDataGenerator.generateDidKeyPersona();

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
        const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog, eventStream);

        const additionalIndexes1 = await record1Data.recordsWrite.constructIndexes(true);
        record1Data.message = await recordsWriteHandler.cloneAndAddEncodedData(record1Data.message, record1Data.dataBytes!);
        await messageStore.put(alice.did, record1Data.message, additionalIndexes1);
        await eventLog.append(alice.did, await Message.getCid(record1Data.message), additionalIndexes1);

        const additionalIndexes2 = await record2Data.recordsWrite.constructIndexes(true);
        record2Data.message = await recordsWriteHandler.cloneAndAddEncodedData(record2Data.message,record2Data.dataBytes!);
        await messageStore.put(alice.did, record2Data.message, additionalIndexes2);
        await eventLog.append(alice.did, await Message.getCid(record2Data.message), additionalIndexes1);

        const additionalIndexes3 = await record3Data.recordsWrite.constructIndexes(true);
        record3Data.message = await recordsWriteHandler.cloneAndAddEncodedData(record3Data.message, record3Data.dataBytes!);
        await messageStore.put(alice.did, record3Data.message, additionalIndexes3);
        await eventLog.append(alice.did, await Message.getCid(record3Data.message), additionalIndexes1);

        const additionalIndexes4 = await record4Data.recordsWrite.constructIndexes(true);
        record4Data.message = await recordsWriteHandler.cloneAndAddEncodedData(record4Data.message, record4Data.dataBytes!);
        await messageStore.put(alice.did, record4Data.message, additionalIndexes4);
        await eventLog.append(alice.did, await Message.getCid(record4Data.message), additionalIndexes1);

        const additionalIndexes5 = await record5Data.recordsWrite.constructIndexes(true);
        record5Data.message = await recordsWriteHandler.cloneAndAddEncodedData(record5Data.message, record5Data.dataBytes!);
        await messageStore.put(alice.did, record5Data.message, additionalIndexes5);
        await eventLog.append(alice.did, await Message.getCid(record5Data.message), additionalIndexes1);

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

        // check for explicitly published:false records for Bob
        const bobQueryPublishedFalse = await TestDataGenerator.generateRecordsQuery({
          author : bob,
          filter : { schema, published: false }
        });
        const unpublishedBobReply = await dwn.processMessage(alice.did, bobQueryPublishedFalse.message);
        expect(unpublishedBobReply.status.code).to.equal(200);
        expect(unpublishedBobReply.entries?.length).to.equal(2);
        const unpublishedBobRecordIds = unpublishedBobReply.entries?.map(e => e.recordId);
        expect(unpublishedBobRecordIds).to.have.members([ record2Data.message.recordId, record3Data.message.recordId ]);

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

        // filter for explicit unpublished public records with carol as recipient, should not return any.
        const bobQueryCarolMessageDataUnpublished = await TestDataGenerator.generateRecordsQuery({
          author : bob,
          filter : { schema, recipient: carol.did, published: false }
        });
        const replyToBobCarolUnpublishedQuery = await dwn.processMessage(alice.did, bobQueryCarolMessageDataUnpublished.message);
        expect(replyToBobCarolUnpublishedQuery.status.code).to.equal(200);
        expect(replyToBobCarolUnpublishedQuery.entries?.length).to.equal(0);
      });

      it('should paginate correctly for fetchRecordsAsNonOwner()', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();
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

        const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog, eventStream);

        const messages: GenericMessage[] = [];
        for await (const { recordsWrite, message, dataBytes } of messagePromises) {
          const indexes = await recordsWrite.constructIndexes(true);
          const processedMessage = await recordsWriteHandler.cloneAndAddEncodedData(message, dataBytes!);
          await messageStore.put(alice.did, processedMessage, indexes);
          await eventLog.append(alice.did, await Message.getCid(processedMessage), indexes);
          messages.push(processedMessage);
        }

        const sortedMessages = await ArrayUtility.asyncSort(
          messages as RecordsWriteMessage[],
          async (a,b) => Message.compareMessageTimestamp(a,b)
        );

        const aliceRetrieved: GenericMessage[] = [];

        // fetch all from alice for sanity, alice should get all of the records
        // page1 alice
        const aliceQueryMessageDataPage1 = await TestDataGenerator.generateRecordsQuery({
          author     : alice,
          filter     : { schema },
          dateSort   : DateSort.CreatedAscending,
          pagination : { limit: 10 },
        });

        let results = await dwn.processMessage(alice.did, aliceQueryMessageDataPage1.message) ;
        expect(results.status.code).to.equal(200);
        expect(results.entries?.length).to.equal(10, 'alice page 1');
        expect(results.cursor, 'alice page 1 cursor').to.not.be.undefined;
        aliceRetrieved.push(...results.entries!);

        // page2 alice
        const aliceQueryMessageDataPage2 = await TestDataGenerator.generateRecordsQuery({
          author     : alice,
          filter     : { schema },
          dateSort   : DateSort.CreatedAscending,
          pagination : { limit: 10, cursor: results.cursor },
        });
        results = await dwn.processMessage(alice.did, aliceQueryMessageDataPage2.message) ;
        expect(results.status.code).to.equal(200);
        expect(results.entries?.length).to.equal(10, 'alice page 2');
        expect(results.cursor, 'alice page 2 cursor').to.not.be.undefined;
        aliceRetrieved.push(...results.entries!);

        // page3 alice
        const aliceQueryMessageDataPage3 = await TestDataGenerator.generateRecordsQuery({
          author     : alice,
          filter     : { schema },
          dateSort   : DateSort.CreatedAscending,
          pagination : { limit: 10, cursor: results.cursor },
        });
        results = await dwn.processMessage(alice.did, aliceQueryMessageDataPage3.message) ;
        expect(results.status.code).to.equal(200);
        expect(results.entries?.length).to.equal(5, 'alice page 3');
        expect(results.cursor, 'alice page 3 cursor').to.not.exist;
        aliceRetrieved.push(...results.entries!);

        const compareRecordId = (a: GenericMessage, b:GenericMessage): boolean => {
          return (a as RecordsWriteMessage).recordId === (b as RecordsWriteMessage).recordId;
        };
        expect(sortedMessages.every((m, i) => compareRecordId(aliceRetrieved.at(i)!, m)));

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
        expect(results.cursor, 'bob page 1 cursor').to.not.be.undefined;
        bobRetrieved.push(...results.entries!);

        const bobQueryMessagePage2 = await TestDataGenerator.generateRecordsQuery({
          author     : bob,
          filter     : { schema },
          dateSort   : DateSort.CreatedAscending,
          pagination : { limit: 10, cursor: results.cursor },
        });
        results = await dwn.processMessage(alice.did, bobQueryMessagePage2.message) ;
        expect(results.status.code).to.equal(200);
        expect(results.entries?.length).to.equal(10, 'bob page 2');
        expect(results.cursor, 'bob page 2 cursor').to.not.exist;
        bobRetrieved.push(...results.entries!);

        expect(bobSorted.every((m, i) => compareRecordId(bobRetrieved.at(i)!, m)));
      });

      // https://github.com/TBD54566975/dwn-sdk-js/issues/170
      it('#170 - should treat records with `published` explicitly set to `false` as unpublished', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();
        const schema = 'schema1';
        const unpublishedRecordsWrite = await TestDataGenerator.generateRecordsWrite(
          { author: alice, schema, data: Encoder.stringToBytes('1'), published: false } // explicitly setting `published` to `false`
        );

        const result1 = await dwn.processMessage(alice.did, unpublishedRecordsWrite.message, { dataStream: unpublishedRecordsWrite.dataStream });
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
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        const bobQueryMessageData = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { recipient: bob.did } // alice as the DWN owner querying bob's records
        });

        const replyToBobQuery = await dwn.processMessage(alice.did, bobQueryMessageData.message);

        expect(replyToBobQuery.status.code).to.equal(200);
      });

      it('should not fetch entries across tenants', async () => {
      // insert three messages into DB, two with matching schema
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();
        const schema = 'myAwesomeSchema';
        const recordsWriteMessage1Data = await TestDataGenerator.generateRecordsWrite({ author: alice, schema });
        const recordsWriteMessage2Data = await TestDataGenerator.generateRecordsWrite({ author: bob, schema });

        const aliceQueryMessageData = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { schema }
        });

        // insert data into 2 different tenants
        await dwn.processMessage(alice.did, recordsWriteMessage1Data.message, { dataStream: recordsWriteMessage1Data.dataStream });
        await dwn.processMessage(bob.did, recordsWriteMessage2Data.message, { dataStream: recordsWriteMessage2Data.dataStream });

        const reply = await dwn.processMessage(alice.did, aliceQueryMessageData.message);

        expect(reply.status.code).to.equal(200);
        expect(reply.entries?.length).to.equal(1);
      });

      it('should return 400 if protocol is not normalized', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // query for non-normalized protocol
        const recordsQuery = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { protocol: 'example.com/' },
        });

        // overwrite protocol because #create auto-normalizes protocol
        recordsQuery.message.descriptor.filter.protocol = 'example.com/';

        // Re-create auth because we altered the descriptor after signing
        recordsQuery.message.authorization = await Message.createAuthorization({
          descriptor : recordsQuery.message.descriptor,
          signer     : Jws.createSigner(alice)
        });

        // Send records write message
        const reply = await dwn.processMessage(alice.did, recordsQuery.message);
        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain(DwnErrorCode.UrlProtocolNotNormalized);
      });

      it('should return 400 if schema is not normalized', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // query for non-normalized schema
        const recordsQuery = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { schema: 'example.com/' },
        });

        // overwrite schema because #create auto-normalizes schema
        recordsQuery.message.descriptor.filter.schema = 'example.com/';

        // Re-create auth because we altered the descriptor after signing
        recordsQuery.message.authorization = await Message.createAuthorization({
          descriptor : recordsQuery.message.descriptor,
          signer     : Jws.createSigner(alice)
        });

        // Send records write message
        const reply = await dwn.processMessage(alice.did, recordsQuery.message);
        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain(DwnErrorCode.UrlSchemaNotNormalized);
      });

      it('should return 400 if published is set to false and a datePublished range is provided', async () => {
        const fromDatePublished = Time.getCurrentTimestamp();
        const alice = await TestDataGenerator.generateDidKeyPersona();
        // set to true so create does not fail
        const recordQuery = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { datePublished: { from: fromDatePublished }, published: true }
        });

        // set to false
        recordQuery.message.descriptor.filter.published = false;
        const queryResponse = await dwn.processMessage(alice.did, recordQuery.message);
        expect(queryResponse.status.code).to.equal(400);
        expect(queryResponse.status.detail).to.contain('descriptor/filter/published: must be equal to one of the allowed values');
      });

      it('should return 401 for anonymous queries that filter explicitly for unpublished records', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // create an unpublished record
        const draftWrite = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'post' });
        const draftWriteReply = await dwn.processMessage(alice.did, draftWrite.message, { dataStream: draftWrite.dataStream });
        expect(draftWriteReply.status.code).to.equal(202);

        // validate that alice can query
        const unpublishedPostQuery = await TestDataGenerator.generateRecordsQuery({ author: alice, filter: { schema: 'post', published: false } });
        const unpublishedPostReply = await dwn.processMessage(alice.did, unpublishedPostQuery.message);
        expect(unpublishedPostReply.status.code).to.equal(200);
        expect(unpublishedPostReply.entries?.length).to.equal(1);
        expect(unpublishedPostReply.entries![0].recordId).to.equal(draftWrite.message.recordId);

        // anonymous query for unpublished records
        const unpublishedAnonymous = await RecordsQuery.create({ filter: { schema: 'post', published: false } });
        const anonymousPostReply = await dwn.processMessage(alice.did, unpublishedAnonymous.message);
        expect(anonymousPostReply.status.code).to.equal(401);
        expect(anonymousPostReply.status.detail).contains('Missing JWS');
      });

      describe('protocol based queries', () => {
        it('does not try protocol authorization if protocolRole is not invoked', async () => {
          // scenario: Alice creates a thread and writes some chat messages. Alice addresses
          //           only one chat message to Bob. Bob queries by protocol URI without invoking a protocolRole,
          //           and he is able to receive the message addressed to him.

          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = threadRoleProtocolDefinition;

          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolsConfigureReply.status.code).to.equal(202);

          // Alice writes a 'thread' record
          const threadRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'thread',
          });
          const threadRoleReply = await dwn.processMessage(alice.did, threadRecord.message, { dataStream: threadRecord.dataStream });
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
          const chatRecordForBobReply = await dwn.processMessage(alice.did, chatRecordForBob.message, { dataStream: chatRecordForBob.dataStream });
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
            const chatReply = await dwn.processMessage(alice.did, chatRecord.message, { dataStream: chatRecord.dataStream });
            expect(chatReply.status.code).to.equal(202);
          }

          // Bob queries without invoking any protocolRole
          const chatQuery = await TestDataGenerator.generateRecordsQuery({
            author : bob,
            filter : {
              protocol: protocolDefinition.protocol,
            },
          });
          const chatQueryReply = await dwn.processMessage(alice.did, chatQuery.message);
          expect(chatQueryReply.status.code).to.equal(200);
          expect(chatQueryReply.entries?.length).to.equal(1);
          expect(chatQueryReply.entries![0].recordId).to.eq(chatRecordForBob.message.recordId);

          // bob queries without invoking any protocolRole and filters for unpublished records
          const unpublishedChatQuery = await TestDataGenerator.generateRecordsQuery({
            author : bob,
            filter : {
              published : false,
              protocol  : protocolDefinition.protocol,
            },
          });
          const unpublishedChatReply = await dwn.processMessage(alice.did, unpublishedChatQuery.message);
          expect(unpublishedChatReply.status.code).to.equal(200);
          expect(unpublishedChatReply.entries?.length).to.equal(1);
          expect(unpublishedChatReply.entries![0].recordId).to.equal(chatRecordForBob.message.recordId);

        });

        it('allows $globalRole authorized queries', async () => {
          // scenario: Alice creates a thread and writes some chat messages writes a chat message. Bob invokes his
          //           thread member role in order to query the chat messages.

          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = friendRoleProtocolDefinition;

          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolsConfigureReply.status.code).to.equal(202);

          // Alice writes a 'friend' $globalRole record with Bob as recipient
          const friendRoleRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : bob.did,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'friend',
            data         : new TextEncoder().encode('Bob is my friend'),
          });
          const friendRoleReply = await dwn.processMessage(alice.did, friendRoleRecord.message, { dataStream: friendRoleRecord.dataStream });
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
            const chatReply = await dwn.processMessage(alice.did, chatRecord.message, { dataStream: chatRecord.dataStream });
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
          const chatQueryReply = await dwn.processMessage(alice.did, chatQuery.message);
          expect(chatQueryReply.status.code).to.equal(200);
          expect(chatQueryReply.entries?.length).to.equal(3);
          expect(chatQueryReply.entries!.map((record) => record.recordId)).to.have.all.members(chatRecordIds);

          // Bob invokes his friendRole along with an explicit filter for unpublished records
          const unpublishedChatQuery = await TestDataGenerator.generateRecordsQuery({
            author : bob,
            filter : {
              published    : false,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'chat',
            },
            protocolRole: 'friend',
          });
          const unpublishedChatReply = await dwn.processMessage(alice.did, unpublishedChatQuery.message);
          expect(unpublishedChatReply.status.code).to.equal(200);
          expect(unpublishedChatReply.entries?.length).to.equal(3);
          expect(unpublishedChatReply.entries!.map((record) => record.recordId)).to.have.all.members(chatRecordIds);
        });

        it('allows $contextRole authorized queries', async () => {
          // scenario: Alice writes some chat messages. Bob invokes his friend role in order to query the chat messages.

          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = threadRoleProtocolDefinition;

          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolsConfigureReply.status.code).to.equal(202);

          // Alice writes a 'thread' record
          const threadRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'thread',
          });
          const threadRoleReply = await dwn.processMessage(alice.did, threadRecord.message, { dataStream: threadRecord.dataStream });
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
          const participantRoleReply =
            await dwn.processMessage(alice.did, participantRoleRecord.message, { dataStream: participantRoleRecord.dataStream });
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
            const chatReply = await dwn.processMessage(alice.did, chatRecord.message, { dataStream: chatRecord.dataStream });
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

          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = friendRoleProtocolDefinition;

          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolsConfigureReply.status.code).to.equal(202);

          // Alice writes a 'friend' $globalRole record with Bob as recipient
          const friendRoleRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : bob.did,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'friend',
            data         : new TextEncoder().encode('Bob is my friend'),
          });
          const friendRoleReply = await dwn.processMessage(alice.did, friendRoleRecord.message, { dataStream: friendRoleRecord.dataStream });
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
            const chatReply = await dwn.processMessage(alice.did, chatRecord.message, { dataStream: chatRecord.dataStream });
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
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = threadRoleProtocolDefinition;

          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolsConfigureReply.status.code).to.equal(202);

          // Alice writes a 'thread' record
          const threadRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'thread',
          });
          const threadRoleReply = await dwn.processMessage(alice.did, threadRecord.message, { dataStream: threadRecord.dataStream });
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
          const participantRoleReply =
            await dwn.processMessage(alice.did, participantRoleRecord.message, { dataStream: participantRoleRecord.dataStream });
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
            const chatReply = await dwn.processMessage(alice.did, chatRecord.message, { dataStream: chatRecord.dataStream });
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

          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = friendRoleProtocolDefinition;

          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolsConfigureReply.status.code).to.equal(202);

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
            const chatReply = await dwn.processMessage(alice.did, chatRecord.message, { dataStream: chatRecord.dataStream });
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
          expect(chatQueryReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationMatchingRoleRecordNotFound);
        });

        it('rejects $contextRole authorized queries where the query author does not have a matching $contextRole', async () => {

          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = threadRoleProtocolDefinition;

          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolsConfigureReply.status.code).to.equal(202);

          // Alice writes a 'thread' record
          const threadRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'thread',
          });
          const threadRoleReply = await dwn.processMessage(alice.did, threadRecord.message, { dataStream: threadRecord.dataStream });
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
            const chatReply = await dwn.processMessage(alice.did, chatRecord.message, { dataStream: chatRecord.dataStream });
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
          expect(chatQueryReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationMatchingRoleRecordNotFound);
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