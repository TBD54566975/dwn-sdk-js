import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ed25519 } from '../../../../src/jose/algorithms/signing/ed25519';
import { handleProtocolsConfigure } from '../../../../src/interfaces/protocols/handlers/protocols-configure';
import { handleProtocolsQuery } from '../../../../src/interfaces/protocols/handlers/protocols-query';
import { MessageStoreLevel } from '../../../../src/store/message-store-level';
import { TestDataGenerator } from '../../../utils/test-data-generator';
import { TestStubGenerator } from '../../../utils/test-stub-generator';

chai.use(chaiAsPromised);

describe('handleProtocolsQuery()', () => {
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
      const targetDid = 'did:example:alice';
      const requesterDid = targetDid;
      const requesterKeyId = `${targetDid}#key1`;
      const requesterKeyPair = await ed25519.generateKeyPair();


      // setting up a stub method resolver
      const didResolverStub = TestStubGenerator.createDidResolverStub(requesterDid, requesterKeyId, requesterKeyPair.publicJwk);

      // insert three messages into DB, two with matching protocol
      const message1Data = await TestDataGenerator.generateProtocolsConfigureMessage({ targetDid, requesterDid, requesterKeyId, requesterKeyPair });
      const message2Data = await TestDataGenerator.generateProtocolsConfigureMessage({ targetDid, requesterDid, requesterKeyId, requesterKeyPair });
      const message3Data = await TestDataGenerator.generateProtocolsConfigureMessage({ targetDid, requesterDid, requesterKeyId, requesterKeyPair });

      await handleProtocolsConfigure(message1Data.message, messageStore, didResolverStub);
      await handleProtocolsConfigure(message2Data.message, messageStore, didResolverStub);
      await handleProtocolsConfigure(message3Data.message, messageStore, didResolverStub);

      // testing singular conditional query
      const queryMessageData = await TestDataGenerator.generateProtocolsQueryMessage({
        targetDid,
        requesterDid,
        requesterKeyId,
        requesterKeyPair,
        filter: { protocol: message1Data.message.descriptor.protocol }
      });

      const reply = await handleProtocolsQuery(queryMessageData.message, messageStore, didResolverStub);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(1); // only 1 entry should match the query on protocol

      // testing fetch-all query without filter
      const queryMessageData2 = await TestDataGenerator.generateProtocolsQueryMessage({
        targetDid,
        requesterDid,
        requesterKeyId,
        requesterKeyPair
      });

      const reply2 = await handleProtocolsQuery(queryMessageData2.message, messageStore, didResolverStub);

      expect(reply2.status.code).to.equal(200);
      expect(reply2.entries?.length).to.equal(3); // expecting all 3 entries written above match the query
    });
  });
});
