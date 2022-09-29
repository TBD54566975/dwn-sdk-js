import { Config } from '../src/dwn';
import { DIDResolutionResult, DIDMethodResolver } from '../src/did/did-resolver';
import { DWN } from '../src/dwn';
import { HandlersWriteMessage } from '../src';
import { MessageReply } from '../src/core';
import { MessageStoreLevel } from '../src/store/message-store-level';
import { TestDataGenerator } from './utils/test-data-generator';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

chai.use(chaiAsPromised);

describe('DWN', () => {
  describe('processMessage()', () => {
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

    it('should process CollectionsWrite message', async () => {
      const messageData = await TestDataGenerator.generateCollectionsWriteMessage();
      const { requesterDidMethod, requesterDid, requesterKeyId, requesterKeyPair } = messageData;

      // setting up a stub method resolver
      const didResolutionResult = TestDataGenerator.createDidResolutionResult(requesterDid, requesterKeyId, requesterKeyPair.publicJwk);
      const resolveStub = sinon.stub<[string], Promise<DIDResolutionResult>>();
      resolveStub.withArgs(requesterDid).resolves(didResolutionResult);
      const methodResolverStub = <DIDMethodResolver>{
        method  : () => { return requesterDidMethod; },
        resolve : resolveStub
      };

      const dwnConfig: Config = {
        DIDMethodResolvers: [methodResolverStub],
        messageStore
      };
      const dwn = await DWN.create(dwnConfig);

      const reply = await dwn.processMessage(messageData.message);

      expect(reply.status.code).to.equal(202);
    });

    it('should process CollectionsQuery message', async () => {
      const messageData = await TestDataGenerator.generateCollectionsQueryMessage();

      // setting up a stub method resolver
      const didResolutionResult = TestDataGenerator.createDidResolutionResult(
        messageData.requesterDid,
        messageData.requesterKeyId,
        messageData.requesterKeyPair.publicJwk
      );
      const resolveStub = sinon.stub<[string], Promise<DIDResolutionResult>>();
      resolveStub.withArgs(messageData.requesterDid).resolves(didResolutionResult);
      const methodResolverStub = <DIDMethodResolver>{
        method  : () => { return messageData.requesterDidMethod; },
        resolve : resolveStub
      };

      const dwnConfig: Config = {
        DIDMethodResolvers: [methodResolverStub],
        messageStore
      };
      const dwn = await DWN.create(dwnConfig);

      const reply = await dwn.processMessage(messageData.message);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries).to.be.empty;
    });

    it('should trigger the right customer handler', async () => {
      const messageData = await TestDataGenerator.generateCollectionsWriteMessage();

      // setting up a stub method resolver
      const didResolutionResult = TestDataGenerator.createDidResolutionResult(
        messageData.requesterDid,
        messageData.requesterKeyId,
        messageData.requesterKeyPair.publicJwk
      );
      const resolveStub = sinon.stub<[string], Promise<DIDResolutionResult>>();
      resolveStub.withArgs(messageData.requesterDid).resolves(didResolutionResult);
      const methodResolverStub = <DIDMethodResolver>{
        method  : () => { return messageData.requesterDidMethod; },
        resolve : resolveStub
      };

      const dwnConfig: Config = {
        DIDMethodResolvers: [methodResolverStub],
        messageStore
      };
      const dwn = await DWN.create(dwnConfig);

      const targetDid = messageData.requesterDid; // target is the same as requester by default generated by `generateCollectionsWriteMessage()`
      const handlersWriteMessageData1 = await TestDataGenerator.generateHandlersWriteMessage({ targetDid });
      const handlersWriteMessageData2 = await TestDataGenerator.generateHandlersWriteMessage(); // this handler should not be triggered

      const mockHandlerReply = { status: { code: 200, detail: 'good stuff mate' } };

      const customHandlerStub1 = sinon.stub<[HandlersWriteMessage], Promise<MessageReply>>();
      customHandlerStub1.resolves(mockHandlerReply);

      const customHandlerStub2 = sinon.stub<[HandlersWriteMessage], Promise<MessageReply>>();
      customHandlerStub1.resolves(mockHandlerReply);

      dwn.addCustomEventHandler(handlersWriteMessageData1.message, customHandlerStub1);
      dwn.addCustomEventHandler(handlersWriteMessageData2.message, customHandlerStub2);

      const actualReply = await dwn.processMessage(messageData.message);
      expect(actualReply).to.equal(mockHandlerReply);

      expect(customHandlerStub1.calledOnce).to.be.true;
      expect(customHandlerStub2.called).to.be.false;
    });
  });
});

