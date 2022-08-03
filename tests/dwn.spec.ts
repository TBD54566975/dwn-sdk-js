import { Config } from '../src/dwn';
import { DIDResolutionResult, DIDMethodResolver } from '../src/did/did-resolver';
import { DWN } from '../src/dwn';
import { MessageStoreLevel } from '../src/store/message-store-level';
import { TestDataGenerator } from './utils/test-data-generator';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

chai.use(chaiAsPromised);

describe('DWN', () => {
  describe('processMessage()', () => {
    const messageStore = new MessageStoreLevel();

    before(async () => {
      await messageStore.open();
    });

    beforeEach(async () => {
      await messageStore.clear();
    });

    after(async () => {
      await messageStore.close();
    });

    it('should process CollectionsWrite message', async () => {
      const messageData = await TestDataGenerator.generateCollectionWriteMessage();

      // setting up a stub method resolver
      const didResolutionResult = TestDataGenerator.createDidResolutionResult(messageData.did, messageData.keyId, messageData.keyPair.publicJwk);
      const resolveStub = sinon.stub<[string], Promise<DIDResolutionResult>>();
      resolveStub.withArgs(messageData.did).resolves(didResolutionResult);
      const methodResolverStub = <DIDMethodResolver>{
        method  : () => { return messageData.didMethod; },
        resolve : resolveStub
      };

      const dwnConfig: Config = {
        DIDMethodResolvers: [methodResolverStub],
        messageStore
      };
      const dwn = await DWN.create(dwnConfig);

      const reply = await dwn.processMessage(messageData.message, { tenant: messageData.did });

      expect(reply.status.code).to.equal(202);
    });

    it('should process CollectionsQuery message', async () => {
      const messageData = await TestDataGenerator.generateCollectionQueryMessage();

      // setting up a stub method resolver
      const didResolutionResult = TestDataGenerator.createDidResolutionResult(
        messageData.requesterDid,
        messageData.requesterKeyId,
        messageData.requesterKeyPair.publicJwk
      );
      const resolveStub = sinon.stub<[string], Promise<DIDResolutionResult>>();
      resolveStub.withArgs(messageData.requesterDid).resolves(didResolutionResult);
      const methodResolverStub = <DIDMethodResolver>{
        method  : () => { return messageData.didMethod; },
        resolve : resolveStub
      };

      const dwnConfig: Config = {
        DIDMethodResolvers: [methodResolverStub],
        messageStore
      };
      const dwn = await DWN.create(dwnConfig);

      const reply = await dwn.processMessage(messageData.message, { tenant: 'did:ion:anyTargetTenant' });

      expect(reply.status.code).to.equal(200);
      expect(reply.entries).to.be.empty;
    });
  });
});

