import { Config } from '../src/dwn';
import { Did } from '../src/did/did';
import { DidKeyResolver } from '../src/did/did-key-resolver';
import { DidResolutionResult, DidMethodResolver } from '../src/did/did-resolver';
import { Dwn } from '../src/dwn';
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

    it('should process CollectionsWrite message signed by a `did:key` DID', async () => {
      // generate a `did:key` DID
      const alice = await DidKeyResolver.generate();

      const messageData = await TestDataGenerator.generateCollectionsWriteMessage({
        requester : alice,
        target    : alice
      });

      const dwnConfig: Config = { messageStore };
      const dwn = await Dwn.create(dwnConfig);

      const reply = await dwn.processMessage(messageData.message);

      expect(reply.status.code).to.equal(202);
    });

    it('should process CollectionsQuery message', async () => {
      const { requester, message } = await TestDataGenerator.generateCollectionsQueryMessage();
      const generatedDidMethod = Did.getMethodName(requester.did);

      // setting up a stub method resolver
      const didResolutionResult = TestDataGenerator.createDidResolutionResult(requester);
      const resolveStub = sinon.stub<[string], Promise<DidResolutionResult>>();
      resolveStub.withArgs(requester.did).resolves(didResolutionResult);
      const methodResolverStub = <DidMethodResolver>{
        method  : () => { return generatedDidMethod; },
        resolve : resolveStub
      };

      const dwnConfig: Config = {
        DidMethodResolvers: [methodResolverStub],
        messageStore
      };
      const dwn = await Dwn.create(dwnConfig);

      const reply = await dwn.processMessage(message);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries).to.be.empty;
    });
  });
});
