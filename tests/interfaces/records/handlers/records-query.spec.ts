import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DidKeyResolver } from '../../../../src/did/did-key-resolver.js';
import { DidResolver } from '../../../../src/index.js';
import { Encoder } from '../../../../src/utils/encoder.js';
import { handleRecordsQuery } from '../../../../src/interfaces/records/handlers/records-query.js';
import { MessageStoreLevel } from '../../../../src/store/message-store-level.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import { TestStubGenerator } from '../../../utils/test-stub-generator.js';

import { constructIndexes, handleRecordsWrite } from '../../../../src/interfaces/records/handlers/records-write.js';
import { DateSort, RecordsQuery } from '../../../../src/interfaces/records/messages/records-query.js';

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
      const write1Data = await TestDataGenerator.generateRecordsWriteMessage({ requester: alice });
      const write2Data = await TestDataGenerator.generateRecordsWriteMessage({ requester: alice, dataFormat, schema: 'schema1' });
      const write3Data = await TestDataGenerator.generateRecordsWriteMessage({ requester: alice, dataFormat, schema: 'schema2' });

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
      const messageData = await TestDataGenerator.generateRecordsQueryMessage({ requester: alice, filter: { dataFormat } });

      const reply = await handleRecordsQuery(alice.did, messageData.message, messageStore, didResolverStub);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(2); // only 2 entries should match the query on protocol

      // testing multi-conditional query, reuse data generated above for bob
      const messageData2 = await TestDataGenerator.generateRecordsQueryMessage({
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

    it('should not include `authorization` in returned records', async () => {
      // insert three messages into DB, two with matching protocol
      const alice = await TestDataGenerator.generatePersona();
      const { message } = await TestDataGenerator.generateRecordsWriteMessage({ requester: alice });

      // setting up a stub method resolver
      const didResolverStub = TestStubGenerator.createDidResolverStub(alice);

      const writeReply = await handleRecordsWrite(alice.did, message, messageStore, didResolverStub);
      expect(writeReply.status.code).to.equal(202);

      const queryData = await TestDataGenerator.generateRecordsQueryMessage({
        requester : alice,
        filter    : { schema: message.descriptor.schema }
      });

      const queryReply = await handleRecordsQuery(alice.did, queryData.message, messageStore, didResolverStub);
      expect(queryReply.status.code).to.equal(200);
      expect(queryReply.entries?.length).to.equal(1);
      expect(queryReply.entries[0]['authorization']).to.equal(undefined);
    });

    it('should omit records that are not published if `dateSort` sorts on `datePublished`', async () => {
      // insert three messages into DB, two with matching protocol
      const alice = await TestDataGenerator.generatePersona();
      const schema = 'aSchema';
      const publishedWriteData = await TestDataGenerator.generateRecordsWriteMessage({
        requester: alice, schema, published: true
      });
      const unpublishedWriteData = await TestDataGenerator.generateRecordsWriteMessage({
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
      const publishedAscendingQueryData = await TestDataGenerator.generateRecordsQueryMessage({
        requester : alice,
        dateSort  : DateSort.PublishedAscending,
        filter    : { schema }
      });
      const publishedAscendingQueryReply = await handleRecordsQuery(alice.did, publishedAscendingQueryData.message, messageStore, didResolverStub);

      expect(publishedAscendingQueryReply.entries?.length).to.equal(1);
      expect(publishedAscendingQueryReply.entries[0].descriptor['datePublished']).to.equal(publishedWriteData.message.descriptor.datePublished);

      // test published date scending sort does not include any records that is not published
      const publishedDescendingQueryData = await TestDataGenerator.generateRecordsQueryMessage({
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
      const write1Data = await TestDataGenerator.generateRecordsWriteMessage({ requester: alice, schema, published });
      const write2Data = await TestDataGenerator.generateRecordsWriteMessage({ requester: alice, schema, published });
      const write3Data = await TestDataGenerator.generateRecordsWriteMessage({ requester: alice, schema, published });

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
      const createdAscendingQueryData = await TestDataGenerator.generateRecordsQueryMessage({
        requester : alice,
        dateSort  : DateSort.CreatedAscending,
        filter    : { schema }
      });
      const createdAscendingQueryReply = await handleRecordsQuery(alice.did, createdAscendingQueryData.message, messageStore, didResolverStub);

      expect(createdAscendingQueryReply.entries[0].descriptor['dateCreated']).to.equal(write1Data.message.descriptor.dateCreated);
      expect(createdAscendingQueryReply.entries[1].descriptor['dateCreated']).to.equal(write2Data.message.descriptor.dateCreated);
      expect(createdAscendingQueryReply.entries[2].descriptor['dateCreated']).to.equal(write3Data.message.descriptor.dateCreated);

      // createdDescending test
      const createdDescendingQueryData = await TestDataGenerator.generateRecordsQueryMessage({
        requester : alice,
        dateSort  : DateSort.CreatedDescending,
        filter    : { schema }
      });
      const createdDescendingQueryReply = await handleRecordsQuery(alice.did, createdDescendingQueryData.message, messageStore, didResolverStub);

      expect(createdDescendingQueryReply.entries[0].descriptor['dateCreated']).to.equal(write3Data.message.descriptor.dateCreated);
      expect(createdDescendingQueryReply.entries[1].descriptor['dateCreated']).to.equal(write2Data.message.descriptor.dateCreated);
      expect(createdDescendingQueryReply.entries[2].descriptor['dateCreated']).to.equal(write1Data.message.descriptor.dateCreated);

      // publishedAscending test
      const publishedAscendingQueryData = await TestDataGenerator.generateRecordsQueryMessage({
        requester : alice,
        dateSort  : DateSort.PublishedAscending,
        filter    : { schema }
      });
      const publishedAscendingQueryReply = await handleRecordsQuery(alice.did, publishedAscendingQueryData.message, messageStore, didResolverStub);

      expect(publishedAscendingQueryReply.entries[0].descriptor['datePublished']).to.equal(write1Data.message.descriptor.datePublished);
      expect(publishedAscendingQueryReply.entries[1].descriptor['datePublished']).to.equal(write2Data.message.descriptor.datePublished);
      expect(publishedAscendingQueryReply.entries[2].descriptor['datePublished']).to.equal(write3Data.message.descriptor.datePublished);

      // publishedDescending test
      const publishedDescendingQueryData = await TestDataGenerator.generateRecordsQueryMessage({
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
      const record1Data = await TestDataGenerator.generateRecordsWriteMessage(
        { requester: alice, schema, data: Encoder.stringToBytes('1') }
      );
      const record2Data = await TestDataGenerator.generateRecordsWriteMessage(
        { requester: alice, schema, data: Encoder.stringToBytes('2'), recipientDid: bob.did }
      );
      const record3Data = await TestDataGenerator.generateRecordsWriteMessage(
        { requester: bob, recipientDid: alice.did, schema, data: Encoder.stringToBytes('3') }
      );
      const record4Data = await TestDataGenerator.generateRecordsWriteMessage(
        { requester: alice, schema, data: Encoder.stringToBytes('4'), published: true }
      );

      // directly inserting data to datastore so that we don't have to setup to grant Bob permission to write to Alice's DWN
      const additionalIndexes1 = await constructIndexes(alice.did, record1Data.recordsWrite, true);
      const additionalIndexes2 = await constructIndexes(alice.did, record2Data.recordsWrite, true);
      const additionalIndexes3 = await constructIndexes(alice.did, record3Data.recordsWrite, true);
      const additionalIndexes4 = await constructIndexes(alice.did, record4Data.recordsWrite, true);
      await messageStore.put(record1Data.message, additionalIndexes1);
      await messageStore.put(record2Data.message, additionalIndexes2);
      await messageStore.put(record3Data.message, additionalIndexes3);
      await messageStore.put(record4Data.message, additionalIndexes4);

      // test correctness for Bob's query
      const bobQueryMessageData = await TestDataGenerator.generateRecordsQueryMessage({
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
      const aliceQueryMessageData = await TestDataGenerator.generateRecordsQueryMessage({
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
      const unpublishedRecordsWrite = await TestDataGenerator.generateRecordsWriteMessage(
        { requester: alice, schema, data: Encoder.stringToBytes('1'), published: false } // explicitly setting `published` to `false`
      );

      const result1 = await handleRecordsWrite(alice.did, unpublishedRecordsWrite.message, messageStore, didResolver);
      expect(result1.status.code).to.equal(202);

      // alice should be able to see the unpublished record
      const queryByAlice = await TestDataGenerator.generateRecordsQueryMessage({
        requester : alice,
        filter    : { schema }
      });
      const replyToAliceQuery = await handleRecordsQuery(alice.did, queryByAlice.message, messageStore, didResolver);
      expect(replyToAliceQuery.status.code).to.equal(200);
      expect(replyToAliceQuery.entries?.length).to.equal(1);

      // actual test: bob should not be able to see unpublished record
      const queryByBob = await TestDataGenerator.generateRecordsQueryMessage({
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

      const bobQueryMessageData = await TestDataGenerator.generateRecordsQueryMessage({
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

      const bobQueryMessageData = await TestDataGenerator.generateRecordsQueryMessage({
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
      const recordsWriteMessage1Data = await TestDataGenerator.generateRecordsWriteMessage({ requester: alice, schema });
      const recordsWriteMessage2Data = await TestDataGenerator.generateRecordsWriteMessage({ requester: bob, schema });

      const aliceQueryMessageData = await TestDataGenerator.generateRecordsQueryMessage({
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
    const { requester, message } = await TestDataGenerator.generateRecordsQueryMessage();

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
    const { requester, message } = await TestDataGenerator.generateRecordsQueryMessage();
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

