import { DIDResolutionResult, DIDResolver } from '../../../../src/did/did-resolver';
import { handleCollectionsWrite } from '../../../../src/interfaces/collections/handlers/collections-write';
import { MessageStoreLevel } from '../../../../src/store/message-store-level';
import { secp256k1 } from '../../../../src/jose/algorithms/signing/secp256k1';
import { TestDataGenerator } from '../../../utils/test-data-generator';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

chai.use(chaiAsPromised);

describe('handleCollectionsWrite()', () => {
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

