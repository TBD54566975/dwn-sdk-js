import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { DidResolver } from '../../../../src';
import { DidKeyResolver } from '../../../../src/did/did-key-resolver';
import { handleProtocolsConfigure } from '../../../../src/interfaces/protocols/handlers/protocols-configure';
import { handleProtocolsQuery } from '../../../../src/interfaces/protocols/handlers/protocols-query';
import { MessageStoreLevel } from '../../../../src/store/message-store-level';
import { TestDataGenerator } from '../../../utils/test-data-generator';
import { TestStubGenerator } from '../../../utils/test-stub-generator';

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

    it('should return protocols matching the query', async () => {
      const alice = await TestDataGenerator.generatePersona();

      // setting up a stub method resolver
      const didResolverStub = TestStubGenerator.createDidResolverStub(alice);

      // insert three messages into DB, two with matching protocol
      const message1Data = await TestDataGenerator.generateProtocolsConfigureMessage({ requester: alice, target: alice });
      const message2Data = await TestDataGenerator.generateProtocolsConfigureMessage({ requester: alice, target: alice });
      const message3Data = await TestDataGenerator.generateProtocolsConfigureMessage({ requester: alice, target: alice });

      await handleProtocolsConfigure(message1Data.message, messageStore, didResolverStub);
      await handleProtocolsConfigure(message2Data.message, messageStore, didResolverStub);
      await handleProtocolsConfigure(message3Data.message, messageStore, didResolverStub);

      // testing singular conditional query
      const queryMessageData = await TestDataGenerator.generateProtocolsQueryMessage({
        requester : alice,
        target    : alice,
        filter    : { protocol: message1Data.message.descriptor.protocol }
      });

      const reply = await handleProtocolsQuery(queryMessageData.message, messageStore, didResolverStub);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(1); // only 1 entry should match the query on protocol

      // testing fetch-all query without filter
      const queryMessageData2 = await TestDataGenerator.generateProtocolsQueryMessage({
        requester : alice,
        target    : alice
      });

      const reply2 = await handleProtocolsQuery(queryMessageData2.message, messageStore, didResolverStub);

      expect(reply2.status.code).to.equal(200);
      expect(reply2.entries?.length).to.equal(3); // expecting all 3 entries written above match the query
    });

    it('should return 401 if auth fails', async () => {
      const alice = await DidKeyResolver.generate();
      alice.keyId = 'wrongValue'; // to fail authentication
      const messageData = await TestDataGenerator.generateProtocolsQueryMessage({ requester: alice, target: alice });

      const reply = await handleProtocolsQuery(messageData.message, messageStore, didResolver);

      expect(reply.status.code).to.equal(401);
      expect(reply.status.detail).to.contain('not a valid DID');
    });

    it('should return 500 if encounter an internal error', async () => {
      const alice = await DidKeyResolver.generate();
      const messageData = await TestDataGenerator.generateProtocolsQueryMessage({ requester: alice, target: alice });

      const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);
      messageStoreStub.query.throwsException('anyError'); // simulate a DB read error

      const reply = await handleProtocolsQuery(messageData.message, messageStoreStub, didResolver);

      expect(reply.status.code).to.equal(500);
    });
  });
});
