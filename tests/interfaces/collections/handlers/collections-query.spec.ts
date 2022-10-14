import { CollectionsWriteMessage, DidResolver } from '../../../../src';
import { DidKeyResolver } from '../../../../src/did/did-key-resolver';
import { handleCollectionsQuery } from '../../../../src/interfaces/collections/handlers/collections-query';
import { MessageStoreLevel } from '../../../../src/store/message-store-level';
import { secp256k1 } from '../../../../src/jose/algorithms/signing/secp256k1';
import { TestDataGenerator } from '../../../utils/test-data-generator';
import { TestStubGenerator } from '../../../utils/test-stub-generator';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

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
      const targetDid = 'did:example:alice';
      const requesterDid = targetDid;
      const protocol = 'myAwesomeProtocol';
      const collectionsWriteMessage1Data = await TestDataGenerator.generateCollectionsWriteMessage({ targetDid });
      const collectionsWriteMessage2Data = await TestDataGenerator.generateCollectionsWriteMessage({ targetDid, protocol, schema: 'schema1' });
      const collectionsWriteMessage3Data = await TestDataGenerator.generateCollectionsWriteMessage({ targetDid, protocol, schema: 'schema2' });

      await messageStore.put(collectionsWriteMessage1Data.message, requesterDid);
      await messageStore.put(collectionsWriteMessage2Data.message, requesterDid);
      await messageStore.put(collectionsWriteMessage3Data.message, requesterDid);

      // testing singular conditional query
      const messageData = await TestDataGenerator.generateCollectionsQueryMessage({ targetDid, requesterDid, filter: { protocol } });

      // setting up a stub method resolver
      const didResolverStub = TestStubGenerator.createDidResolverStub(
        messageData.requesterDid,
        messageData.requesterKeyId,
        messageData.requesterKeyPair.publicJwk
      );

      const reply = await handleCollectionsQuery(messageData.message, messageStore, didResolverStub);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(2); // only 2 entries should match the query on protocol

      // testing multi-conditional query, reuse data generated above for bob
      const requesterKeyId = messageData.requesterKeyId;
      const requesterKeyPair = messageData.requesterKeyPair;
      const messageData2 = await TestDataGenerator.generateCollectionsQueryMessage({
        targetDid,
        requesterDid,
        requesterKeyId,
        requesterKeyPair,
        filter: {
          protocol,
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
      const schema = 'schema1';
      const aliceDidData = await DidKeyResolver.generate();
      const bobDidData = await DidKeyResolver.generate();
      const record1Data = await TestDataGenerator.generateCollectionsWriteMessage({ targetDid: aliceDidData.did, schema, contextId: '1' });
      const record2Data = await TestDataGenerator.generateCollectionsWriteMessage(
        { targetDid: aliceDidData.did, schema, contextId: '2', recipientDid: bobDidData.did }
      );
      const record3Data = await TestDataGenerator.generateCollectionsWriteMessage( {
        targetDid        : aliceDidData.did,
        schema,
        contextId        : '3',
        recipientDid     : aliceDidData.did,
        requesterDid     : bobDidData.did,
        requesterKeyId   : DidKeyResolver.getKeyId(bobDidData.did),
        requesterKeyPair : bobDidData.keyPair
      });
      const record4Data = await TestDataGenerator.generateCollectionsWriteMessage(
        { targetDid: aliceDidData.did, schema, contextId: '4', published: true }
      );

      await messageStore.put(record1Data.message, aliceDidData.did);
      await messageStore.put(record2Data.message, aliceDidData.did);
      await messageStore.put(record3Data.message, bobDidData.did);
      await messageStore.put(record4Data.message, aliceDidData.did);

      // test correctness for Bob's query
      const bobQueryMessageData = await TestDataGenerator.generateCollectionsQueryMessage({
        targetDid        : aliceDidData.did,
        requesterDid     : bobDidData.did,
        requesterKeyId   : DidKeyResolver.getKeyId(bobDidData.did),
        requesterKeyPair : bobDidData.keyPair,
        filter           : { schema }
      });

      const replyToBobQuery = await handleCollectionsQuery(bobQueryMessageData.message, messageStore, didResolver);

      expect(replyToBobQuery.status.code).to.equal(200);
      expect(replyToBobQuery.entries?.length).to.equal(3); // expect 3 records

      const privateRecordsForBob = replyToBobQuery.entries.filter(message => (message as CollectionsWriteMessage).descriptor.contextId === '2');
      const privateRecordsFromBob = replyToBobQuery.entries.filter(message => (message as CollectionsWriteMessage).descriptor.contextId === '3');
      const publicRecords = replyToBobQuery.entries.filter(message => (message as CollectionsWriteMessage).descriptor.contextId === '4');
      expect(privateRecordsForBob.length).to.equal(1);
      expect(privateRecordsFromBob.length).to.equal(1);
      expect(publicRecords.length).to.equal(1);

      // test correctness for Alice's query
      const aliceQueryMessageData = await TestDataGenerator.generateCollectionsQueryMessage({
        targetDid        : aliceDidData.did,
        requesterDid     : aliceDidData.did,
        requesterKeyId   : DidKeyResolver.getKeyId(aliceDidData.did),
        requesterKeyPair : aliceDidData.keyPair,
        filter           : { schema }
      });

      const replyToAliceQuery = await handleCollectionsQuery(aliceQueryMessageData.message, messageStore, didResolver);

      expect(replyToAliceQuery.status.code).to.equal(200);
      expect(replyToAliceQuery.entries?.length).to.equal(4); // expect all 4 records
    });


    it('should throw if querying for records not intended for the requester', async () => {
      const aliceDidData = await DidKeyResolver.generate();
      const bobDidData = await DidKeyResolver.generate();
      const carolDidData = await DidKeyResolver.generate();

      // test correctness for Bob's query
      const bobQueryMessageData = await TestDataGenerator.generateCollectionsQueryMessage({
        targetDid        : aliceDidData.did,
        requesterDid     : bobDidData.did,
        requesterKeyId   : DidKeyResolver.getKeyId(bobDidData.did),
        requesterKeyPair : bobDidData.keyPair,
        filter           : { recipient: carolDidData.did } // bob querying carol's records
      });

      const replyToBobQuery = await handleCollectionsQuery(bobQueryMessageData.message, messageStore, didResolver);

      expect(replyToBobQuery.status.code).to.equal(401);
      expect(replyToBobQuery.status.detail).to.contain('not allowed to query records');
    });

    it('should not fetch entries across tenants', async () => {
      // insert three messages into DB, two with matching schema
      const did1 = 'did:example:alice';
      const did2 = 'did:example:bob';
      const protocol = 'myAwesomeProtocol';
      const collectionsWriteMessage1Data = await TestDataGenerator.generateCollectionsWriteMessage({ targetDid: did1, protocol });
      const collectionsWriteMessage2Data = await TestDataGenerator.generateCollectionsWriteMessage({ targetDid: did2, protocol });

      // insert data into 2 different tenants
      await messageStore.put(collectionsWriteMessage1Data.message, 'did:example:irrelevant');
      await messageStore.put(collectionsWriteMessage2Data.message, 'did:example:irrelevant');

      const did1QueryMessageData = await TestDataGenerator.generateCollectionsQueryMessage({
        requesterDid : did1,
        targetDid    : did1,
        filter       : { protocol }
      });

      // setting up a stub method resolver
      const didResolverStub = TestStubGenerator.createDidResolverStub(
        did1QueryMessageData.requesterDid,
        did1QueryMessageData.requesterKeyId,
        did1QueryMessageData.requesterKeyPair.publicJwk
      );

      const reply = await handleCollectionsQuery(did1QueryMessageData.message, messageStore, didResolverStub);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(1);
    });
  });

  it('should return 401 if signature check fails', async () => {
    const messageData = await TestDataGenerator.generateCollectionsQueryMessage();

    // setting up a stub did resolver & message store
    const differentKeyPair = await secp256k1.generateKeyPair(); // used to return a different public key to simulate invalid signature
    const didResolverStub = TestStubGenerator.createDidResolverStub(
      messageData.requesterDid,
      messageData.requesterKeyId,
      differentKeyPair.publicJwk
    );
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

    const reply = await handleCollectionsQuery(messageData.message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(401);
  });

  it('should return 500 if authorization fails', async () => {
    const messageData = await TestDataGenerator.generateCollectionsQueryMessage();

    // setting up a stub method resolver & message store
    const didResolverStub = TestStubGenerator.createDidResolverStub(
      messageData.requesterDid,
      messageData.requesterKeyId,
      messageData.requesterKeyPair.publicJwk
    );
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);
    messageStoreStub.query.throwsException('anyError'); // simulate a DB query error

    const reply = await handleCollectionsQuery(messageData.message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(500);
  });

  it('should return 500 if query contains `dateSort`', async () => {
    const messageData = await TestDataGenerator.generateCollectionsQueryMessage({ dateSort: 'createdAscending' });

    // setting up a stub method resolver & message store
    const didResolverStub = TestStubGenerator.createDidResolverStub(
      messageData.requesterDid,
      messageData.requesterKeyId,
      messageData.requesterKeyPair.publicJwk
    );
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);
    messageStoreStub.query.throwsException('anyError'); // simulate a DB query error

    const reply = await handleCollectionsQuery(messageData.message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(500);
    expect(reply.status.detail).to.equal('`dateSort` not implemented');
  });
});

