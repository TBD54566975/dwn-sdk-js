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
    let messageStore: MessageStoreLevel;

    before(async () => {
      // important to follow this pattern to initialize the message store in tests
      // so that different suites can reuse the same block store and index location for testing
      messageStore = new MessageStoreLevel({
        blockstoreLocation : 'TEST-BLOCKSTORE',
        indexLocation      : 'TEST-INDEX'
      });

      await messageStore.open();
    });

    beforeEach(async () => {
      await messageStore.clear(); // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
    });

    after(async () => {
      await messageStore.close();
    });

    it('should return entries matching the query', async () => {
      // insert three messages into DB, two with matching protocol
      const targetDid = 'did:example:alice';
      const protocol = 'myAwesomeProtocol';
      const collectionsWriteMessage1Data = await TestDataGenerator.generateCollectionWriteMessage({ targetDid });
      const collectionsWriteMessage2Data = await TestDataGenerator.generateCollectionWriteMessage({ targetDid, protocol, schema: 'schema1' });
      const collectionsWriteMessage3Data = await TestDataGenerator.generateCollectionWriteMessage({ targetDid, protocol, schema: 'schema2' });

      await messageStore.put(collectionsWriteMessage1Data.message);
      await messageStore.put(collectionsWriteMessage2Data.message);
      await messageStore.put(collectionsWriteMessage3Data.message);

      // testing singular conditional query
      const requesterDid = 'did:example:bob';
      const messageData = await TestDataGenerator.generateCollectionQueryMessage({ targetDid, requesterDid, filter: { protocol } });

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
      const messageData2 = await TestDataGenerator.generateCollectionQueryMessage({
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


    it('should not fetch entries across tenants', async () => {
      // insert three messages into DB, two with matching schema
      const did1 = 'did:example:alice';
      const did2 = 'did:example:bob';
      const protocol = 'myAwesomeProtocol';
      const collectionsWriteMessage1Data = await TestDataGenerator.generateCollectionWriteMessage({ targetDid: did1, protocol });
      const collectionsWriteMessage2Data = await TestDataGenerator.generateCollectionWriteMessage({ targetDid: did2, protocol });

      // insert data into 2 different tenants
      await messageStore.put(collectionsWriteMessage1Data.message);
      await messageStore.put(collectionsWriteMessage2Data.message);

      const did1QueryMessageData = await TestDataGenerator.generateCollectionQueryMessage({
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

  it('should return 401 if authorization fails', async () => {
    const messageData = await TestDataGenerator.generateCollectionQueryMessage();

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
    const messageData = await TestDataGenerator.generateCollectionQueryMessage();

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
    const messageData = await TestDataGenerator.generateCollectionQueryMessage({ dateSort: 'createdAscending' });

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
    expect(reply.status.message).to.equal('`dateSort` not implemented');
  });
});

