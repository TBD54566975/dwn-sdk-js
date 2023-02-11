import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DidKeyResolver } from '../../../../src/did/did-key-resolver.js';
import { Encoder } from '../../../../src/utils/encoder.js';
import { handleRecordsQuery } from '../../../../src/interfaces/records/handlers/records-query.js';
import { Jws } from '../../../../src/utils/jws.js';
import { MessageStoreLevel } from '../../../../src/store/message-store-level.js';
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
      const write1 = await TestDataGenerator.generateRecordsWrite({ requester: alice });
      const write2 = await TestDataGenerator.generateRecordsWrite({ requester: alice, dataFormat, schema: 'schema1' });
      const write3 = await TestDataGenerator.generateRecordsWrite({ requester: alice, dataFormat, schema: 'schema2' });

      // setting up a stub method resolver
      const didResolver = TestStubGenerator.createDidResolverStub(alice);

      // insert data
      const writeReply1 = await handleRecordsWrite({
        tenant: alice.did, message: write1.message, messageStore, didResolver, dataStream: write1.dataStream
      });
      const writeReply2 = await handleRecordsWrite({
        tenant: alice.did, message: write2.message, messageStore, didResolver, dataStream: write2.dataStream
      });
      const writeReply3 = await handleRecordsWrite({
        tenant: alice.did, message: write3.message, messageStore, didResolver, dataStream: write3.dataStream
      });
      expect(writeReply1.status.code).to.equal(202);
      expect(writeReply2.status.code).to.equal(202);
      expect(writeReply3.status.code).to.equal(202);

      // testing singular conditional query
      const messageData = await TestDataGenerator.generateRecordsQuery({ requester: alice, filter: { dataFormat } });

      const reply = await handleRecordsQuery({ tenant: alice.did, message: messageData.message, messageStore, didResolver });

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

      const reply2 = await handleRecordsQuery({ tenant: alice.did, message: messageData2.message, messageStore, didResolver });

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
      const writeReply1 = await handleRecordsWrite({
        tenant: alice.did, message: recordsWrite1.message, messageStore, didResolver, dataStream: recordsWrite1.dataStream
      });
      const writeReply2 = await handleRecordsWrite({
        tenant: alice.did, message: recordsWrite2.message, messageStore, didResolver, dataStream: recordsWrite2.dataStream
      });
      expect(writeReply1.status.code).to.equal(202);
      expect(writeReply2.status.code).to.equal(202);

      // testing attester filter
      const recordsQuery1 = await TestDataGenerator.generateRecordsQuery({ requester: alice, filter: { attester: alice.did } });
      const reply1 = await handleRecordsQuery({ tenant: alice.did, message: recordsQuery1.message, messageStore, didResolver });
      expect(reply1.entries?.length).to.equal(1);
      const reply1Attester = Jws.getSignerDid((reply1.entries[0] as RecordsWriteMessage).attestation.signatures[0]);
      expect(reply1Attester).to.equal(alice.did);

      // testing attester + another filter
      const recordsQuery2 = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { attester: bob.did, schema: recordsWrite2.message.descriptor.schema }
      });
      const reply2 = await handleRecordsQuery({ tenant: alice.did, message: recordsQuery2.message, messageStore, didResolver });
      expect(reply2.entries?.length).to.equal(1);
      const reply2Attester = Jws.getSignerDid((reply2.entries[0] as RecordsWriteMessage).attestation.signatures[0]);
      expect(reply2Attester).to.equal(bob.did);

      // testing attester filter that yields no results
      const carol = await DidKeyResolver.generate();
      const recordsQuery3 = await TestDataGenerator.generateRecordsQuery({ requester: alice, filter: { attester: carol.did } });
      const reply3 = await handleRecordsQuery({ tenant: alice.did, message: recordsQuery3.message, messageStore, didResolver });
      expect(reply3.entries?.length).to.equal(0);
    });

    it('should not include `authorization` in returned records', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice });

      // setting up a stub method resolver
      const didResolver = TestStubGenerator.createDidResolverStub(alice);

      const writeReply = await handleRecordsWrite({ tenant: alice.did, message, messageStore, didResolver, dataStream });
      expect(writeReply.status.code).to.equal(202);

      const queryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { schema: message.descriptor.schema }
      });

      const queryReply = await handleRecordsQuery({ tenant: alice.did, message: queryData.message, messageStore, didResolver });
      expect(queryReply.status.code).to.equal(200);
      expect(queryReply.entries?.length).to.equal(1);
      expect(queryReply.entries[0]['authorization']).to.equal(undefined);
    });

    it('should include `attestation` in returned records', async () => {
      // scenario: alice and bob attest to a message alice authored

      const alice = await DidKeyResolver.generate();
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice, attesters: [alice] });

      const writeReply = await handleRecordsWrite({ tenant: alice.did, message: message, messageStore, didResolver, dataStream });
      expect(writeReply.status.code).to.equal(202);

      const queryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { schema: message.descriptor.schema }
      });

      const queryReply = await handleRecordsQuery({ tenant: alice.did, message: queryData.message, messageStore, didResolver });
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
      const didResolver = TestStubGenerator.createDidResolverStub(alice);

      // insert data
      const publishedWriteReply = await handleRecordsWrite({
        tenant: alice.did, message: publishedWriteData.message, messageStore, didResolver, dataStream: publishedWriteData.dataStream
      });
      const unpublishedWriteReply = await handleRecordsWrite({
        tenant: alice.did, message: unpublishedWriteData.message, messageStore, didResolver, dataStream: unpublishedWriteData.dataStream
      });
      expect(publishedWriteReply.status.code).to.equal(202);
      expect(unpublishedWriteReply.status.code).to.equal(202);

      // test published date ascending sort does not include any records that is not published
      const publishedAscendingQueryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        dateSort  : DateSort.PublishedAscending,
        filter    : { schema }
      });
      const publishedAscendingQueryReply = await handleRecordsQuery({
        tenant: alice.did, message: publishedAscendingQueryData.message, messageStore, didResolver
      });

      expect(publishedAscendingQueryReply.entries?.length).to.equal(1);
      expect(publishedAscendingQueryReply.entries[0].descriptor['datePublished']).to.equal(publishedWriteData.message.descriptor.datePublished);

      // test published date scending sort does not include any records that is not published
      const publishedDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        dateSort  : DateSort.PublishedDescending,
        filter    : { schema }
      });
      const publishedDescendingQueryReply = await handleRecordsQuery({
        tenant: alice.did, message: publishedDescendingQueryData.message, messageStore, didResolver
      });

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
      const didResolver = TestStubGenerator.createDidResolverStub(alice);

      // insert data, intentionally out of order
      const writeReply2 = await handleRecordsWrite({
        tenant: alice.did, message: write2Data.message, messageStore, didResolver, dataStream: write2Data.dataStream
      });
      const writeReply1 = await handleRecordsWrite({
        tenant: alice.did, message: write1Data.message, messageStore, didResolver, dataStream: write1Data.dataStream
      });
      const writeReply3 = await handleRecordsWrite({
        tenant: alice.did, message: write3Data.message, messageStore, didResolver, dataStream: write3Data.dataStream
      });
      expect(writeReply1.status.code).to.equal(202);
      expect(writeReply2.status.code).to.equal(202);
      expect(writeReply3.status.code).to.equal(202);

      // createdAscending test
      const createdAscendingQueryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        dateSort  : DateSort.CreatedAscending,
        filter    : { schema }
      });
      const createdAscendingQueryReply = await handleRecordsQuery({
        tenant: alice.did, message: createdAscendingQueryData.message, messageStore, didResolver
      });

      expect(createdAscendingQueryReply.entries[0].descriptor['dateCreated']).to.equal(write1Data.message.descriptor.dateCreated);
      expect(createdAscendingQueryReply.entries[1].descriptor['dateCreated']).to.equal(write2Data.message.descriptor.dateCreated);
      expect(createdAscendingQueryReply.entries[2].descriptor['dateCreated']).to.equal(write3Data.message.descriptor.dateCreated);

      // createdDescending test
      const createdDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        dateSort  : DateSort.CreatedDescending,
        filter    : { schema }
      });
      const createdDescendingQueryReply = await handleRecordsQuery({
        tenant: alice.did, message: createdDescendingQueryData.message, messageStore, didResolver
      });

      expect(createdDescendingQueryReply.entries[0].descriptor['dateCreated']).to.equal(write3Data.message.descriptor.dateCreated);
      expect(createdDescendingQueryReply.entries[1].descriptor['dateCreated']).to.equal(write2Data.message.descriptor.dateCreated);
      expect(createdDescendingQueryReply.entries[2].descriptor['dateCreated']).to.equal(write1Data.message.descriptor.dateCreated);

      // publishedAscending test
      const publishedAscendingQueryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        dateSort  : DateSort.PublishedAscending,
        filter    : { schema }
      });
      const publishedAscendingQueryReply = await handleRecordsQuery({
        tenant: alice.did, message: publishedAscendingQueryData.message, messageStore, didResolver
      });

      expect(publishedAscendingQueryReply.entries[0].descriptor['datePublished']).to.equal(write1Data.message.descriptor.datePublished);
      expect(publishedAscendingQueryReply.entries[1].descriptor['datePublished']).to.equal(write2Data.message.descriptor.datePublished);
      expect(publishedAscendingQueryReply.entries[2].descriptor['datePublished']).to.equal(write3Data.message.descriptor.datePublished);

      // publishedDescending test
      const publishedDescendingQueryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        dateSort  : DateSort.PublishedDescending,
        filter    : { schema }
      });
      const publishedDescendingQueryReply = await handleRecordsQuery({
        tenant: alice.did, message: publishedDescendingQueryData.message, messageStore, didResolver
      });

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
      await messageStore.put(record1Data.message, additionalIndexes1, record1Data.dataStream);
      await messageStore.put(record2Data.message, additionalIndexes2, record2Data.dataStream);
      await messageStore.put(record3Data.message, additionalIndexes3, record3Data.dataStream);
      await messageStore.put(record4Data.message, additionalIndexes4, record4Data.dataStream);

      // test correctness for Bob's query
      const bobQueryMessageData = await TestDataGenerator.generateRecordsQuery({
        requester : bob,
        filter    : { schema }
      });

      const replyToBob = await handleRecordsQuery({ tenant: alice.did, message: bobQueryMessageData.message, messageStore, didResolver });

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

      const replyToAliceQuery = await handleRecordsQuery({ tenant: alice.did, message: aliceQueryMessageData.message, messageStore, didResolver });

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

      const result1 = await handleRecordsWrite({
        tenant: alice.did, message: unpublishedRecordsWrite.message, messageStore, didResolver, dataStream: unpublishedRecordsWrite.dataStream
      });
      expect(result1.status.code).to.equal(202);

      // alice should be able to see the unpublished record
      const queryByAlice = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { schema }
      });
      const replyToAliceQuery = await handleRecordsQuery({ tenant: alice.did, message: queryByAlice.message, messageStore, didResolver });
      expect(replyToAliceQuery.status.code).to.equal(200);
      expect(replyToAliceQuery.entries?.length).to.equal(1);

      // actual test: bob should not be able to see unpublished record
      const queryByBob = await TestDataGenerator.generateRecordsQuery({
        requester : bob,
        filter    : { schema }
      });
      const replyToBobQuery = await handleRecordsQuery({ tenant: alice.did, message: queryByBob.message, messageStore, didResolver });
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

      const replyToBobQuery = await handleRecordsQuery({ tenant: alice.did, message: bobQueryMessageData.message, messageStore, didResolver });

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

      const replyToBobQuery = await handleRecordsQuery({ tenant: alice.did, message: bobQueryMessageData.message, messageStore, didResolver });

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
      await handleRecordsWrite({
        tenant: alice.did, message: recordsWriteMessage1Data.message, messageStore, didResolver, dataStream: recordsWriteMessage1Data.dataStream
      });
      await handleRecordsWrite({
        tenant: bob.did, message: recordsWriteMessage2Data.message, messageStore, didResolver, dataStream: recordsWriteMessage2Data.dataStream
      });

      const reply = await handleRecordsQuery({ tenant: alice.did, message: aliceQueryMessageData.message, messageStore, didResolver });

      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(1);
    });
  });

  it('should return 401 if signature check fails', async () => {
    const { requester, message } = await TestDataGenerator.generateRecordsQuery();

    // setting up a stub did resolver & message store
    // intentionally not supplying the public key so a different public key is generated to simulate invalid signature
    const mismatchingPersona = await TestDataGenerator.generatePersona({ did: requester.did, keyId: requester.keyId });
    const didResolver = TestStubGenerator.createDidResolverStub(mismatchingPersona);
    const messageStore = sinon.createStubInstance(MessageStoreLevel);

    const tenant = requester.did;
    const reply = await handleRecordsQuery({ tenant, message, messageStore, didResolver });

    expect(reply.status.code).to.equal(401);
  });

  it('should return 400 if fail parsing the message', async () => {
    const { requester, message } = await TestDataGenerator.generateRecordsQuery();
    const tenant = requester.did;

    // setting up a stub method resolver & message store
    const didResolver = TestStubGenerator.createDidResolverStub(requester);
    const messageStore = sinon.createStubInstance(MessageStoreLevel);

    // stub the `parse()` function to throw an error
    sinon.stub(RecordsQuery, 'parse').throws('anyError');
    const reply = await handleRecordsQuery({ tenant, message, messageStore, didResolver });

    expect(reply.status.code).to.equal(400);
  });
});

