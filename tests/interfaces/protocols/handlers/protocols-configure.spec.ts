import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { compareCids } from '../../../../src/utils/cid';
import { DidResolver } from '../../../../src';
import { Message } from '../../../../src/core';
import { DidKeyResolver } from '../../../../src/did/did-key-resolver';
import { handleProtocolsConfigure } from '../../../../src/interfaces/protocols/handlers/protocols-configure';
import { MessageStoreLevel } from '../../../../src/store/message-store-level';
import { TestDataGenerator } from '../../../utils/test-data-generator';
import { handleProtocolsQuery } from '../../../../src/interfaces/protocols/handlers/protocols-query';

chai.use(chaiAsPromised);

describe('handleProtocolsQuery()', () => {
  describe('functional tests', () => {
    let didResolver: DidResolver;
    let messageStore: MessageStoreLevel;

    before(async () => {
      didResolver = new DidResolver([new DidKeyResolver()]);

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

    it('should return 401 if auth fails', async () => {
      const alice = await DidKeyResolver.generate();
      alice.keyId = 'wrongValue'; // to fail authentication
      const messageData = await TestDataGenerator.generateProtocolsConfigureMessage({ requester: alice, target: alice });

      const reply = await handleProtocolsConfigure(messageData.message, messageStore, didResolver);
      expect(reply.status.code).to.equal(401);
      expect(reply.status.detail).to.contain('not a valid DID');
    });

    it('should return 500 if encounter an internal error', async () => {
      const alice = await DidKeyResolver.generate();
      const messageData = await TestDataGenerator.generateProtocolsConfigureMessage({ requester: alice, target: alice });

      const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);
      messageStoreStub.put.throwsException('anyError'); // simulate a DB write error

      const reply = await handleProtocolsConfigure(messageData.message, messageStoreStub, didResolver);

      expect(reply.status.code).to.equal(500);
    });

    it('should only be able to overwrite existing protocol if new protocol lexicographically larger', async () => {
    // generate three versions of the same protocol message
      const alice = await DidKeyResolver.generate();
      const protocol = 'exampleProtocol';
      const messageData1 = await TestDataGenerator.generateProtocolsConfigureMessage({ requester: alice, target: alice, protocol });
      const messageData2 = await TestDataGenerator.generateProtocolsConfigureMessage({ requester: alice, target: alice, protocol });
      const messageData3 = await TestDataGenerator.generateProtocolsConfigureMessage({ requester: alice, target: alice, protocol });

      const messageDataWithCid = [];
      for (const messageData of [messageData1, messageData2, messageData3]) {
        const cid = await Message.getCid(messageData.message);
        messageDataWithCid.push({ cid, ...messageData });
      }

      // sort the message in lexicographic order
      const [
        messageDataWithSmallestLexicographicValue,
        messageDataWithMediumLexicographicValue,
        messageDataWithLargestLexicographicValue
      ] = messageDataWithCid.sort((messageDataA, messageDataB) => { return compareCids(messageDataA.cid, messageDataB.cid); });

      // write the protocol with the middle lexicographic value
      let reply = await handleProtocolsConfigure(messageDataWithMediumLexicographicValue.message, messageStore, didResolver);
      expect(reply.status.code).to.equal(202);

      // test that the protocol with the smallest lexicographic value cannot be written
      reply = await handleProtocolsConfigure(messageDataWithSmallestLexicographicValue.message, messageStore, didResolver);
      expect(reply.status.code).to.equal(409);

      // test that the protocol with the largest lexicographic value can be written
      reply = await handleProtocolsConfigure(messageDataWithLargestLexicographicValue.message, messageStore, didResolver);
      expect(reply.status.code).to.equal(202);

      // test that old protocol message is removed from DB and only the newer protocol message remains
      const queryMessageData = await TestDataGenerator.generateProtocolsQueryMessage({ requester: alice, target: alice, filter: { protocol } });
      reply = await handleProtocolsQuery(queryMessageData.message, messageStore, didResolver);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries.length).to.equal(1);

      const actualMessageCid = await Message.getCid(reply.entries[0]);
      expect(actualMessageCid.toString()).to.equal(messageDataWithLargestLexicographicValue.cid.toString());
    });
  });
});
