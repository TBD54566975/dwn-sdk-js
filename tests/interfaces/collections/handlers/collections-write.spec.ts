import { base64url } from 'multiformats/bases/base64';
import { CollectionsWriteSchema } from '../../../../src/interfaces/collections/types';
import { DIDResolutionResult, DIDResolver } from '../../../../src/did/did-resolver';
import { GenerateCollectionWriteMessageOutput, TestDataGenerator } from '../../../utils/test-data-generator';
import { handleCollectionsQuery } from '../../../../src/interfaces/collections/handlers/collections-query';
import { handleCollectionsWrite } from '../../../../src/interfaces/collections/handlers/collections-write';
import { MessageStoreLevel } from '../../../../src/store/message-store-level';
import { secp256k1 } from '../../../../src/jose/algorithms/signing/secp256k1';
import { TestStubGenerator } from '../../../utils/test-stub-generator';
import { v4 as uuidv4 } from 'uuid';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

chai.use(chaiAsPromised);

describe('handleCollectionsWrite()', () => {
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

    it('should only be able to overwrite existing record if new record has a later `dateCreated` value', async () => {
      // write a message into DB
      const targetDid = 'did:example:alice';
      const requesterDid = targetDid;
      const recordId = uuidv4();
      const data1 = new TextEncoder().encode('data1');
      const collectionsWriteMessageData = await TestDataGenerator.generateCollectionWriteMessage({ targetDid, requesterDid, recordId, data: data1 });
      const { requesterKeyId, requesterKeyPair } = collectionsWriteMessageData;

      // setting up a stub did resolver
      const didResolverStub = TestStubGenerator.createDidResolverStub(requesterDid, requesterKeyId, requesterKeyPair.publicJwk);

      const collectionsWriteReply = await handleCollectionsWrite(collectionsWriteMessageData.message, messageStore, didResolverStub);
      expect(collectionsWriteReply.status.code).to.equal(202);

      const collectionsQueryMessageData = await TestDataGenerator.generateCollectionQueryMessage({
        targetDid,
        requesterDid,
        requesterKeyId,
        requesterKeyPair,
        filter: { recordId }
      });

      // verify the message written can be queried
      const collectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
      expect(collectionsQueryReply.status.code).to.equal(200);
      expect(collectionsQueryReply.entries?.length).to.equal(1);
      expect((collectionsQueryReply.entries![0] as CollectionsWriteSchema).encodedData).to.equal(base64url.baseEncode(data1));

      // generate and write a new CollectionsWrite to overwrite the existing record
      // a new CollectionsWrite by default will have a later `dateCreate` due to the default Date.now() call
      const data2 = new TextEncoder().encode('data2');
      const newCollectionsWriteMessageData = await TestDataGenerator.generateCollectionWriteMessage({
        targetDid,
        requesterDid,
        requesterKeyId,
        requesterKeyPair,
        recordId,
        data: data2 // new data value
      });
      const newCollectionsWriteReply = await handleCollectionsWrite(newCollectionsWriteMessageData.message, messageStore, didResolverStub);
      expect(newCollectionsWriteReply.status.code).to.equal(202);

      // verify new record has overwritten the existing record
      const newCollectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);

      expect(newCollectionsQueryReply.status.code).to.equal(200);
      expect(newCollectionsQueryReply.entries?.length).to.equal(1);
      expect((newCollectionsQueryReply.entries![0] as CollectionsWriteSchema).encodedData).to.equal(base64url.baseEncode(data2));

      // try to write the older message to store again and verify that it is not accepted
      const thirdCollectionsWriteReply = await handleCollectionsWrite(collectionsWriteMessageData.message, messageStore, didResolverStub);
      expect(thirdCollectionsWriteReply.status.code).to.equal(409); // expecting to fail

      // expecting unchanged
      const thirdCollectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
      expect(thirdCollectionsQueryReply.status.code).to.equal(200);
      expect(thirdCollectionsQueryReply.entries?.length).to.equal(1);
      expect((thirdCollectionsQueryReply.entries![0] as CollectionsWriteSchema).encodedData).to.equal(base64url.baseEncode(data2));
    });

    it('should only be able to overwrite existing record if new message CID is larger when `dateCreated` value is the same', async () => {
      // generate two messages with the same `dateCreated` value
      const targetDid = 'did:example:alice';
      const requesterDid = targetDid;
      const recordId = uuidv4();
      const dateCreated = Date.now();
      const collectionsWriteMessageData1 = await TestDataGenerator.generateCollectionWriteMessage({
        targetDid,
        requesterDid,
        recordId,
        dateCreated,
        data: new TextEncoder().encode('data1')
      });
      const { requesterKeyId, requesterKeyPair } = collectionsWriteMessageData1;

      const collectionsWriteMessageData2 = await TestDataGenerator.generateCollectionWriteMessage({
        targetDid,
        requesterDid,
        requesterKeyId,
        requesterKeyPair,
        recordId,
        dateCreated, // simulate the exact same dateCreated as message 1 above
        data: new TextEncoder().encode('data2') // a different CID value
      });

      // determine the lexicographical order of the two messages
      let largerCollectionWriteMessageData: GenerateCollectionWriteMessageOutput;
      let smallerCollectionWriteMessageData: GenerateCollectionWriteMessageOutput;
      if (collectionsWriteMessageData1.messageCid > collectionsWriteMessageData2.messageCid) {
        largerCollectionWriteMessageData = collectionsWriteMessageData1;
        smallerCollectionWriteMessageData = collectionsWriteMessageData2;
      } else {
        largerCollectionWriteMessageData = collectionsWriteMessageData2;
        smallerCollectionWriteMessageData = collectionsWriteMessageData1;
      }

      // setting up a stub did resolver
      const didResolverStub = TestStubGenerator.createDidResolverStub(requesterDid, requesterKeyId, requesterKeyPair.publicJwk);

      // write the message with the smaller lexicographical message CID first
      const collectionsWriteReply = await handleCollectionsWrite(smallerCollectionWriteMessageData.message, messageStore, didResolverStub);
      expect(collectionsWriteReply.status.code).to.equal(202);

      // query to fetch the record
      const collectionsQueryMessageData = await TestDataGenerator.generateCollectionQueryMessage({
        targetDid,
        requesterDid,
        requesterKeyId,
        requesterKeyPair,
        filter: { recordId }
      });

      // verify the data is written
      const collectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
      expect(collectionsQueryReply.status.code).to.equal(200);
      expect(collectionsQueryReply.entries?.length).to.equal(1);
      expect((collectionsQueryReply.entries![0] as CollectionsWriteSchema).descriptor.dataCid)
        .to.equal(smallerCollectionWriteMessageData.message.descriptor.dataCid);

      // attempt to write the message with larger lexicographical message CID
      const newCollectionsWriteReply = await handleCollectionsWrite(largerCollectionWriteMessageData.message, messageStore, didResolverStub);
      expect(newCollectionsWriteReply.status.code).to.equal(202);

      // verify new record has overwritten the existing record
      const newCollectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
      expect(newCollectionsQueryReply.status.code).to.equal(200);
      expect(newCollectionsQueryReply.entries?.length).to.equal(1);
      expect((newCollectionsQueryReply.entries![0] as CollectionsWriteSchema).descriptor.dataCid)
        .to.equal(largerCollectionWriteMessageData.message.descriptor.dataCid);

      // try to write the message with smaller lexicographical message CID again
      const thirdCollectionsWriteReply = await handleCollectionsWrite(
        smallerCollectionWriteMessageData.message,
        messageStore,
        didResolverStub
      );
      expect(thirdCollectionsWriteReply.status.code).to.equal(409); // expecting to fail

      // verify the message in store is still the one with larger lexicographical message CID
      const thirdCollectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
      expect(thirdCollectionsQueryReply.status.code).to.equal(200);
      expect(thirdCollectionsQueryReply.entries?.length).to.equal(1);
      expect((thirdCollectionsQueryReply.entries![0] as CollectionsWriteSchema).descriptor.dataCid)
        .to.equal(largerCollectionWriteMessageData.message.descriptor.dataCid); // expecting unchanged
    });
  });

  it('should return 400 if actual CID of `data` mismatches with `dataCid` in descriptor', async () => {
    const messageData = await TestDataGenerator.generateCollectionWriteMessage();
    messageData.message.encodedData = base64url.baseEncode(TestDataGenerator.randomBytes(50));

    const didResolverStub = sinon.createStubInstance(DIDResolver);
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

    const reply = await handleCollectionsWrite(messageData.message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(400);
    expect(reply.status.message).to.equal('actual CID of data and `dataCid` in descriptor mismatch');
  });

  it('should return 401 if signature check fails', async () => {
    const messageData = await TestDataGenerator.generateCollectionWriteMessage();
    const { requesterDid, requesterKeyId } = messageData;

    // setting up a stub did resolver & message store
    const differentKeyPair = await secp256k1.generateKeyPair(); // used to return a different public key to simulate invalid signature
    const didResolverStub = TestStubGenerator.createDidResolverStub(requesterDid, requesterKeyId, differentKeyPair.publicJwk);

    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

    const reply = await handleCollectionsWrite(messageData.message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(401);
  });

  it('should return 401 if requester is not the same as the target', async () => {
    const requesterDid = 'did:example:alice';
    const targetDid = 'did:example:bob'; // requester and target are different
    const { message, requesterKeyId, requesterKeyPair } = await TestDataGenerator.generateCollectionQueryMessage({ requesterDid, targetDid });

    // setting up a stub did resolver & message store
    const didResolverStub = TestStubGenerator.createDidResolverStub(requesterDid, requesterKeyId, requesterKeyPair.publicJwk);
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

    const reply = await handleCollectionsWrite(message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(401);
  });

  it('should return 500 if encounter an internal error', async () => {
    const messageData = await TestDataGenerator.generateCollectionWriteMessage();
    const { requesterDid, requesterKeyId, requesterKeyPair } = messageData;

    // setting up a stub method resolver & message store
    const didResolutionResult = TestDataGenerator.createDidResolutionResult(requesterDid, requesterKeyId, requesterKeyPair.publicJwk);
    const resolveStub = sinon.stub<[string], Promise<DIDResolutionResult>>();
    resolveStub.withArgs(requesterDid).resolves(didResolutionResult);
    const didResolverStub = sinon.createStubInstance(DIDResolver, { resolve: resolveStub });
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);
    messageStoreStub.put.throwsException('anyError'); // simulate a DB write error

    const reply = await handleCollectionsWrite(messageData.message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(500);
  });
});

