import { Config } from '../src/dwn';
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
      const { did, keyPair } = await DidKeyResolver.generate();

      // the key ID must also be correct according to the key generated
      const requesterKeyId = DidKeyResolver.getKeyId(did);

      const messageData = await TestDataGenerator.generateCollectionsWriteMessage({
        requesterDid     : did,
        requesterKeyId,
        requesterKeyPair : keyPair,
        targetDid        : did
      });

      const dwnConfig: Config = { messageStore };
      const dwn = await Dwn.create(dwnConfig);

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
      const resolveStub = sinon.stub<[string], Promise<DidResolutionResult>>();
      resolveStub.withArgs(messageData.requesterDid).resolves(didResolutionResult);
      const methodResolverStub = <DidMethodResolver>{
        method  : () => { return messageData.requesterDidMethod; },
        resolve : resolveStub
      };

      const dwnConfig: Config = {
        DidMethodResolvers: [methodResolverStub],
        messageStore
      };
      const dwn = await Dwn.create(dwnConfig);

      const reply = await dwn.processMessage(messageData.message);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries).to.be.empty;
    });
  });
});
