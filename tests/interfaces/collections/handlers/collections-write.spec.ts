import { DIDResolutionResult, DIDResolver } from '../../../../src/did/did-resolver';
import { handleCollectionsWrite } from '../../../../src/interfaces/collections/handlers/collections-write';
import { handleCollectionsQuery } from '../../../../src/interfaces/collections/handlers/collections-query';
import { MessageStoreLevel } from '../../../../src/store/message-store-level';
import { secp256k1 } from '../../../../src/jose/algorithms/signing/secp256k1';
import { TestDataGenerator } from '../../../utils/test-data-generator';
import { v4 as uuidv4 } from 'uuid';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { CollectionsWriteSchema } from '../../../../src/interfaces/collections/types';

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

    it('[WIP] should be able to overwrite existing record', async () => {
      // insert three messages into DB, two with matching protocol
      const targetDid = 'did:example:alice';
      const requesterDid = 'did:example:bob';
      const recordId = uuidv4();
      const collectionsWriteMessageData = await TestDataGenerator.generateCollectionWriteMessage({ requesterDid, recordId, dataCid: 'dataCid1' });
      const { requesterKeyId, requesterKeyPair } = collectionsWriteMessageData;

      // setting up a stub did resolver & message store
      const didResolutionResult = TestDataGenerator.createDidResolutionResult(requesterDid, requesterKeyId, requesterKeyPair.publicJwk);
      const resolveStub = sinon.stub<[string], Promise<DIDResolutionResult>>();
      resolveStub.withArgs(requesterDid).resolves(didResolutionResult);
      const didResolverStub = sinon.createStubInstance(DIDResolver, { resolve: resolveStub });

      const context = { tenant: targetDid };
      // const collectionsWriteReply = await handleCollectionsWrite(context, collectionsWriteMessageData.message, messageStore, didResolverStub);
      // expect(collectionsWriteReply.status.code).to.equal(202);
      await messageStore.put(collectionsWriteMessageData.message, context);

      const collectionsQueryMessageData = await TestDataGenerator.generateCollectionQueryMessage({
        requesterDid,
        requesterKeyId,
        requesterKeyPair,
        filter: { protocol: collectionsWriteMessageData.message.descriptor.protocol }
      });

      const collectionsQueryReply = await handleCollectionsQuery(context, collectionsQueryMessageData.message, messageStore, didResolverStub);

      expect(collectionsQueryReply.status.code).to.equal(200);
      expect(collectionsQueryReply.entries).to.not.be.undefined;
      expect((collectionsQueryReply.entries![0] as CollectionsWriteSchema).descriptor.dataCid).to.equal('dataCid1');
    });
  });

  it('should return 401 if authorization fails', async () => {
    const messageData = await TestDataGenerator.generateCollectionWriteMessage();
    const { requesterDid, requesterKeyId } = messageData;

    // setting up a stub did resolver & message store
    const differentKeyPair = await secp256k1.generateKeyPair(); // used to return a different public key to simulate invalid signature
    const didResolutionResult = TestDataGenerator.createDidResolutionResult(requesterDid, requesterKeyId, differentKeyPair.publicJwk);
    const resolveStub = sinon.stub<[string], Promise<DIDResolutionResult>>();
    resolveStub.withArgs(requesterDid).resolves(didResolutionResult);
    const didResolverStub = sinon.createStubInstance(DIDResolver, { resolve: resolveStub });
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

    const context = { tenant: requesterDid };
    const reply = await handleCollectionsWrite(context, messageData.message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(401);
  });

  it('should return 500 if authorization fails', async () => {
    const messageData = await TestDataGenerator.generateCollectionWriteMessage();
    const { requesterDid, requesterKeyId, requesterKeyPair } = messageData;

    // setting up a stub method resolver & message store
    const didResolutionResult = TestDataGenerator.createDidResolutionResult(requesterDid, requesterKeyId, requesterKeyPair.publicJwk);
    const resolveStub = sinon.stub<[string], Promise<DIDResolutionResult>>();
    resolveStub.withArgs(requesterDid).resolves(didResolutionResult);
    const didResolverStub = sinon.createStubInstance(DIDResolver, { resolve: resolveStub });
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);
    messageStoreStub.put.throwsException('anyError'); // simulate a DB write error

    const context = { tenant: requesterDid };
    const reply = await handleCollectionsWrite(context, messageData.message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(500);
  });
});

