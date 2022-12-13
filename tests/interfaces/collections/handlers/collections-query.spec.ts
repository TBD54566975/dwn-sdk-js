import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DidKeyResolver } from '../../../../src/did/did-key-resolver.js';
import { DidResolver } from '../../../../src/index.js';
import { Encoder } from '../../../../src/utils/encoder.js';
import { handleCollectionsQuery } from '../../../../src/interfaces/collections/handlers/collections-query.js';
import { MessageStoreLevel } from '../../../../src/store/message-store-level.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import { TestStubGenerator } from '../../../utils/test-stub-generator.js';
import { constructAdditionalIndexes, handleCollectionsWrite } from '../../../../src/interfaces/collections/handlers/collections-write.js';

chai.use(chaiAsPromised);

describe('handleCollectionsQuery()', () => {
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
      await messageStore.clear(); // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
    });

    after(async () => {
      await messageStore.close();
    });

    it('should return records matching the query', async () => {
      // insert three messages into DB, two with matching protocol
      const alice = await TestDataGenerator.generatePersona();
      const dataFormat = 'myAwesomeDataFormat';
      const write1Data = await TestDataGenerator.generateCollectionsWriteMessage({ requester: alice, target: alice });
      const write2Data = await TestDataGenerator.generateCollectionsWriteMessage({ requester: alice, target: alice, dataFormat, schema: 'schema1' });
      const write3Data = await TestDataGenerator.generateCollectionsWriteMessage({ requester: alice, target: alice, dataFormat, schema: 'schema2' });

      // setting up a stub method resolver
      const didResolverStub = TestStubGenerator.createDidResolverStub(alice);

      // insert data into 3 different tenants
      const writeReply1 = await handleCollectionsWrite(write1Data.message, messageStore, didResolverStub);
      const writeReply2 = await handleCollectionsWrite(write2Data.message, messageStore, didResolverStub);
      const writeReply3 = await handleCollectionsWrite(write3Data.message, messageStore, didResolverStub);
      expect(writeReply1.status.code).to.equal(202);
      expect(writeReply2.status.code).to.equal(202);
      expect(writeReply3.status.code).to.equal(202);

      // testing singular conditional query
      const messageData = await TestDataGenerator.generateCollectionsQueryMessage({ requester: alice, target: alice, filter: { dataFormat } });

      const reply = await handleCollectionsQuery(messageData.message, messageStore, didResolverStub);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(2); // only 2 entries should match the query on protocol

      // testing multi-conditional query, reuse data generated above for bob
      const messageData2 = await TestDataGenerator.generateCollectionsQueryMessage({
        requester : alice,
        target    : alice,
        filter    : {
          dataFormat,
          schema: 'schema1'
        }
      });

      const reply2 = await handleCollectionsQuery(messageData2.message, messageStore, didResolverStub);

      expect(reply2.status.code).to.equal(200);
      expect(reply2.entries?.length).to.equal(1); // only 1 entry should match the query
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
      const record1Data = await TestDataGenerator.generateCollectionsWriteMessage(
        { requester: alice, target: alice, schema, data: Encoder.stringToBytes('1') }
      );
      const record2Data = await TestDataGenerator.generateCollectionsWriteMessage(
        { requester: alice, target: alice, schema, data: Encoder.stringToBytes('2'), recipientDid: bob.did }
      );
      const record3Data = await TestDataGenerator.generateCollectionsWriteMessage(
        { requester: bob, target: alice, recipientDid: alice.did, schema, data: Encoder.stringToBytes('3') }
      );
      const record4Data = await TestDataGenerator.generateCollectionsWriteMessage(
        { requester: alice, target: alice, schema, data: Encoder.stringToBytes('4'), published: true, datePublished: 123 }
      );

      // directly inserting data to datastore so that we don't have to setup to grant Bob permission to write to Alice's DWN
      const additionalIndexes1 = constructAdditionalIndexes(record1Data.collectionsWrite, true);
      const additionalIndexes2 = constructAdditionalIndexes(record2Data.collectionsWrite, true);
      const additionalIndexes3 = constructAdditionalIndexes(record3Data.collectionsWrite, true);
      const additionalIndexes4 = constructAdditionalIndexes(record4Data.collectionsWrite, true);
      await messageStore.put(record1Data.message, additionalIndexes1);
      await messageStore.put(record2Data.message, additionalIndexes2);
      await messageStore.put(record3Data.message, additionalIndexes3);
      await messageStore.put(record4Data.message, additionalIndexes4);

      // test correctness for Bob's query
      const bobQueryMessageData = await TestDataGenerator.generateCollectionsQueryMessage({
        requester : bob,
        target    : alice,
        filter    : { schema }
      });

      const replyToBob = await handleCollectionsQuery(bobQueryMessageData.message, messageStore, didResolver);

      expect(replyToBob.status.code).to.equal(200);
      expect(replyToBob.entries?.length).to.equal(3); // expect 3 records

      const privateRecordsForBob = replyToBob.entries.filter(message => (message as any).encodedData === Encoder.stringToBase64Url('2'));
      const privateRecordsFromBob = replyToBob.entries.filter(message => (message as any).encodedData === Encoder.stringToBase64Url('3'));
      const publicRecords = replyToBob.entries.filter(message => (message as any).encodedData === Encoder.stringToBase64Url('4'));
      expect(privateRecordsForBob.length).to.equal(1);
      expect(privateRecordsFromBob.length).to.equal(1);
      expect(publicRecords.length).to.equal(1);

      // test correctness for Alice's query
      const aliceQueryMessageData = await TestDataGenerator.generateCollectionsQueryMessage({
        requester : alice,
        target    : alice,
        filter    : { schema }
      });

      const replyToAliceQuery = await handleCollectionsQuery(aliceQueryMessageData.message, messageStore, didResolver);

      expect(replyToAliceQuery.status.code).to.equal(200);
      expect(replyToAliceQuery.entries?.length).to.equal(4); // expect all 4 records
    });


    it('should throw if querying for records not intended for the requester', async () => {
      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();
      const carol = await DidKeyResolver.generate();

      // test correctness for Bob's query
      const bobQueryMessageData = await TestDataGenerator.generateCollectionsQueryMessage({
        requester : bob,
        target    : alice,
        filter    : { recipient: carol.did } // bob querying carol's records
      });

      const replyToBobQuery = await handleCollectionsQuery(bobQueryMessageData.message, messageStore, didResolver);

      expect(replyToBobQuery.status.code).to.equal(401);
      expect(replyToBobQuery.status.detail).to.contain('not allowed to query records');
    });

    it('should not fetch entries across tenants', async () => {
      // insert three messages into DB, two with matching schema
      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();
      const schema = 'myAwesomeSchema';
      const collectionsWriteMessage1Data = await TestDataGenerator.generateCollectionsWriteMessage({ requester: alice, target: alice, schema });
      const collectionsWriteMessage2Data = await TestDataGenerator.generateCollectionsWriteMessage({ requester: bob, target: bob, schema });

      const aliceQueryMessageData = await TestDataGenerator.generateCollectionsQueryMessage({
        requester : alice,
        target    : alice,
        filter    : { schema }
      });

      // insert data into 2 different tenants
      const didResolver = new DidResolver([new DidKeyResolver()]);
      await handleCollectionsWrite(collectionsWriteMessage1Data.message, messageStore, didResolver);
      await handleCollectionsWrite(collectionsWriteMessage2Data.message, messageStore, didResolver);

      const reply = await handleCollectionsQuery(aliceQueryMessageData.message, messageStore, didResolver);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(1);
    });
  });

  it('should return 401 if signature check fails', async () => {
    const { requester, message } = await TestDataGenerator.generateCollectionsQueryMessage();

    // setting up a stub did resolver & message store
    // intentionally not supplying the public key so a different public key is generated to simulate invalid signature
    const mismatchingPersona = await TestDataGenerator.generatePersona({ did: requester.did, keyId: requester.keyId });
    const didResolverStub = TestStubGenerator.createDidResolverStub(mismatchingPersona);
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

    const reply = await handleCollectionsQuery(message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(401);
  });

  it('should return 500 if authorization fails', async () => {
    const { requester, message } = await TestDataGenerator.generateCollectionsQueryMessage();

    // setting up a stub method resolver & message store
    const didResolverStub = TestStubGenerator.createDidResolverStub(requester);
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);
    messageStoreStub.query.throwsException('anyError'); // simulate a DB query error

    const reply = await handleCollectionsQuery(message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(500);
  });

  it('should return 400 if query contains `dateSort`', async () => {
    const { requester, message } = await TestDataGenerator.generateCollectionsQueryMessage({ dateSort: 'createdAscending' });

    // setting up a stub method resolver & message store
    const didResolverStub = TestStubGenerator.createDidResolverStub(requester);
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);
    messageStoreStub.query.throwsException('anyError'); // simulate a DB query error

    const reply = await handleCollectionsQuery(message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(400);
    expect(reply.status.detail).to.equal('`dateSort` not implemented');
  });
});

