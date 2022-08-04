import { DIDResolutionResult, DIDResolver } from '../../../../src/did/did-resolver';
import { handleCollectionsQuery } from '../../../../src/interfaces/collections/handlers/collections-query';
import { MessageStoreLevel } from '../../../../src/store/message-store-level';
import { secp256k1 } from '../../../../src/jose/algorithms/signing/secp256k1';
import { TestDataGenerator } from '../../../utils/test-data-generator';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

chai.use(chaiAsPromised);

describe('handleCollectionsQuery()', () => {
  describe('end-to-end functional tests', () => {
    let messageStore: MessageStoreLevel;

    before(async () => {
      // important to follow this pattern to initialize the message store in tests
      // so different suites can reuse the same block store and index location
      messageStore = new MessageStoreLevel({
        blockstoreLocation : 'TEST-BLOCKSTORE',
        indexLocation      : 'TEST-INDEX'
      });

      await messageStore.open();
    });

    afterEach(async () => {
      await messageStore.clear();
    });

    after(async () => {
      await messageStore.close();
    });

    it('should return entries matching the query', async () => {
    // insert three messages into DB, two with matching schema
      const did = 'did:example:alice';
      const schema = 'myAwesomeSchema';
      const collectionsWriteMessage1Data = await TestDataGenerator.generateCollectionWriteMessage();
      const collectionsWriteMessage2Data = await TestDataGenerator.generateCollectionWriteMessage({ schema });
      const collectionsWriteMessage3Data = await TestDataGenerator.generateCollectionWriteMessage({ schema });

      await messageStore.put(collectionsWriteMessage1Data.message, { tenant: did });
      await messageStore.put(collectionsWriteMessage2Data.message, { tenant: did });
      await messageStore.put(collectionsWriteMessage3Data.message, { tenant: did });

      // generating a query that matches two of the messages written
      const messageData = await TestDataGenerator.generateCollectionQueryMessage({ schema });

      // setting up a stub method resolver & message store
      const didResolutionResult = TestDataGenerator.createDidResolutionResult(
        messageData.requesterDid,
        messageData.requesterKeyId,
        messageData.requesterKeyPair.publicJwk
      );
      const resolveStub = sinon.stub<[string], Promise<DIDResolutionResult>>();
      resolveStub.withArgs(messageData.requesterDid).resolves(didResolutionResult);
      const didResolverStub = sinon.createStubInstance(DIDResolver, { resolve: resolveStub });


      const context = { tenant: messageData.requesterDid };
      const reply = await handleCollectionsQuery(context, messageData.message, messageStore, didResolverStub);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(2); // only 2 entries should match the query.
    });
  });

  it('should return 401 if authorization fails', async () => {
    const messageData = await TestDataGenerator.generateCollectionQueryMessage();

    // setting up a stub did resolver & message store
    const differentKeyPair = await secp256k1.generateKeyPair(); // used to return a different public key to simulate invalid signature
    const didResolutionResult = TestDataGenerator.createDidResolutionResult(
      messageData.requesterDid,
      messageData.requesterKeyId,
      differentKeyPair.publicJwk
    );
    const resolveStub = sinon.stub<[string], Promise<DIDResolutionResult>>();
    resolveStub.withArgs(messageData.requesterDid).resolves(didResolutionResult);
    const didResolverStub = sinon.createStubInstance(DIDResolver, { resolve: resolveStub });
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

    const context = { tenant: messageData.requesterDid };
    const reply = await handleCollectionsQuery(context, messageData.message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(401);
  });

  it('should return 500 if authorization fails', async () => {
    const messageData = await TestDataGenerator.generateCollectionQueryMessage();

    // setting up a stub method resolver & message store
    const didResolutionResult = TestDataGenerator.createDidResolutionResult(
      messageData.requesterDid,
      messageData.requesterKeyId,
      messageData.requesterKeyPair.publicJwk
    );
    const resolveStub = sinon.stub<[string], Promise<DIDResolutionResult>>();
    resolveStub.withArgs(messageData.requesterDid).resolves(didResolutionResult);
    const didResolverStub = sinon.createStubInstance(DIDResolver, { resolve: resolveStub });
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);
    messageStoreStub.query.throwsException('anyError'); // simulate a DB query error

    const context = { tenant: messageData.requesterDid };
    const reply = await handleCollectionsQuery(context, messageData.message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(500);
  });
});

