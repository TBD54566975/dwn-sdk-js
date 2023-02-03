import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DidKeyResolver } from '../../../../src/did/did-key-resolver.js';
import { GeneralJwsSigner } from '../../../../src/jose/jws/general/signer.js';
import { handleProtocolsConfigure } from '../../../../src/interfaces/protocols/handlers/protocols-configure.js';
import { handleProtocolsQuery } from '../../../../src/interfaces/protocols/handlers/protocols-query.js';
import { MessageStoreLevel } from '../../../../src/store/message-store-level.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import { TestStubGenerator } from '../../../utils/test-stub-generator.js';

import { DidResolver, Encoder } from '../../../../src/index.js';

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
      const message1Data = await TestDataGenerator.generateProtocolsConfigure({ requester: alice });
      const message2Data = await TestDataGenerator.generateProtocolsConfigure({ requester: alice });
      const message3Data = await TestDataGenerator.generateProtocolsConfigure({ requester: alice });

      await handleProtocolsConfigure(alice.did, message1Data.message, messageStore, didResolverStub);
      await handleProtocolsConfigure(alice.did, message2Data.message, messageStore, didResolverStub);
      await handleProtocolsConfigure(alice.did, message3Data.message, messageStore, didResolverStub);

      // testing singular conditional query
      const queryMessageData = await TestDataGenerator.generateProtocolsQuery({
        requester : alice,
        filter    : { protocol: message1Data.message.descriptor.protocol }
      });

      const reply = await handleProtocolsQuery(alice.did, queryMessageData.message, messageStore, didResolverStub);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(1); // only 1 entry should match the query on protocol

      // testing fetch-all query without filter
      const queryMessageData2 = await TestDataGenerator.generateProtocolsQuery({
        requester: alice
      });

      const reply2 = await handleProtocolsQuery(alice.did, queryMessageData2.message, messageStore, didResolverStub);

      expect(reply2.status.code).to.equal(200);
      expect(reply2.entries?.length).to.equal(3); // expecting all 3 entries written above match the query
    });

    it('should fail with 400 if `authorization` is referencing a different message (`descriptorCid`)', async () => {
      const { requester, message, protocolsQuery } = await TestDataGenerator.generateProtocolsQuery();
      const tenant = requester.did;

      // replace `authorization` with incorrect `descriptorCid`, even though signature is still valid
      const incorrectDescriptorCid = await TestDataGenerator.randomCborSha256Cid();
      const authorizationPayload = { ...protocolsQuery.authorizationPayload };
      authorizationPayload.descriptorCid = incorrectDescriptorCid;
      const authorizationPayloadBytes = Encoder.objectToBytes(authorizationPayload);
      const signatureInput = TestDataGenerator.createSignatureInputFromPersona(requester);
      const signer = await GeneralJwsSigner.create(authorizationPayloadBytes, [signatureInput]);
      message.authorization = signer.getJws();

      const didResolverStub = TestStubGenerator.createDidResolverStub(requester);
      const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);
      const reply = await handleProtocolsQuery(tenant, message, messageStoreStub, didResolverStub);

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain(`${incorrectDescriptorCid} does not match expected CID`);
    });

    it('should return 401 if auth fails', async () => {
      const alice = await DidKeyResolver.generate();
      alice.keyId = 'wrongValue'; // to fail authentication
      const messageData = await TestDataGenerator.generateProtocolsQuery({ requester: alice });

      const reply = await handleProtocolsQuery(alice.did, messageData.message, messageStore, didResolver);

      expect(reply.status.code).to.equal(401);
      expect(reply.status.detail).to.contain('not a valid DID');
    });
  });
});
