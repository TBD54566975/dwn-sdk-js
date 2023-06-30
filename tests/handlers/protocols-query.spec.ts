import type {
  DataStore,
  EventLog,
  MessageStore
} from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DidKeyResolver } from '../../src/did/did-key-resolver.js';
import { GeneralJwsSigner } from '../../src/jose/jws/general/signer.js';
import { Message } from '../../src/core/message.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStoreInitializer } from '../test-store-initializer.js';
import { TestStubGenerator } from '../utils/test-stub-generator.js';

import { DidResolver, Dwn, DwnErrorCode, Encoder, Jws } from '../../src/index.js';

chai.use(chaiAsPromised);

describe('ProtocolsQueryHandler.handle()', () => {
  let didResolver: DidResolver;
  let messageStore: MessageStore;
  let dataStore: DataStore;
  let eventLog: EventLog;
  let dwn: Dwn;

  describe('functional tests', () => {

    // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
    // so that different test suites can reuse the same backend store for testing
    before(async () => {
      didResolver = new DidResolver([new DidKeyResolver()]);

      const stores = TestStoreInitializer.initializeStores();
      messageStore = stores.messageStore;
      dataStore = stores.dataStore;
      eventLog = stores.eventLog;

      dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog });
    });

    beforeEach(async () => {
      sinon.restore(); // wipe all previous stubs/spies/mocks/fakes

      // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
      await messageStore.clear();
      await dataStore.clear();
      await eventLog.clear();
    });

    after(async () => {
      await dwn.close();
    });

    it('should return protocols matching the query', async () => {
      const alice = await TestDataGenerator.generatePersona();

      // setting up a stub method resolver
      TestStubGenerator.stubDidResolver(didResolver, [alice]);

      // insert three messages into DB, two with matching protocol
      const protocol1 = await TestDataGenerator.generateProtocolsConfigure({ author: alice });
      const protocol2 = await TestDataGenerator.generateProtocolsConfigure({ author: alice });
      const protocol3 = await TestDataGenerator.generateProtocolsConfigure({ author: alice });

      await dwn.processMessage(alice.did, protocol1.message, protocol1.dataStream);
      await dwn.processMessage(alice.did, protocol2.message, protocol2.dataStream);
      await dwn.processMessage(alice.did, protocol3.message, protocol3.dataStream);

      // testing singular conditional query
      const queryMessageData = await TestDataGenerator.generateProtocolsQuery({
        author : alice,
        filter : { protocol: protocol1.message.descriptor.definition.protocol }
      });

      const reply = await dwn.processMessage(alice.did, queryMessageData.message);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(1); // only 1 entry should match the query on protocol

      // testing fetch-all query without filter
      const queryMessageData2 = await TestDataGenerator.generateProtocolsQuery({
        author: alice
      });

      const reply2 = await dwn.processMessage(alice.did, queryMessageData2.message);

      expect(reply2.status.code).to.equal(200);
      expect(reply2.entries?.length).to.equal(3); // expecting all 3 entries written above match the query
    });

    it('should return 400 if protocol is not normalized', async () => {
      const alice = await DidKeyResolver.generate();

      // query for non-normalized protocol
      const protocolsQuery = await TestDataGenerator.generateProtocolsQuery({
        author : alice,
        filter : { protocol: 'example.com/' },
      });

      // overwrite protocol because #create auto-normalizes protocol
      protocolsQuery.message.descriptor.filter!.protocol = 'example.com/';

      // Re-create auth because we altered the descriptor after signing
      protocolsQuery.message.authorization = await Message.signAsAuthorization(
        protocolsQuery.message.descriptor,
        Jws.createSignatureInput(alice)
      );

      // Send records write message
      const reply = await dwn.processMessage(alice.did, protocolsQuery.message);
      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain(DwnErrorCode.UrlProtocolNotNormalized);
    });

    it('should fail with 400 if `authorization` is referencing a different message (`descriptorCid`)', async () => {
      const { author, message, protocolsQuery } = await TestDataGenerator.generateProtocolsQuery();
      const tenant = author.did;

      // replace `authorization` with incorrect `descriptorCid`, even though signature is still valid
      const incorrectDescriptorCid = await TestDataGenerator.randomCborSha256Cid();
      const authorizationPayload = { ...protocolsQuery.authorizationPayload };
      authorizationPayload.descriptorCid = incorrectDescriptorCid;
      const authorizationPayloadBytes = Encoder.objectToBytes(authorizationPayload);
      const signatureInput = Jws.createSignatureInput(author);
      const signer = await GeneralJwsSigner.create(authorizationPayloadBytes, [signatureInput]);
      message.authorization = signer.getJws();

      const reply = await dwn.processMessage(tenant, message);

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain(`${incorrectDescriptorCid} does not match expected CID`);
    });

    it('should return 401 if auth fails', async () => {
      const alice = await DidKeyResolver.generate();
      alice.keyId = 'wrongValue'; // to fail authentication
      const { message } = await TestDataGenerator.generateProtocolsQuery({ author: alice });

      const reply = await dwn.processMessage(alice.did, message);

      expect(reply.status.code).to.equal(401);
      expect(reply.status.detail).to.contain('not a valid DID');
    });
  });
});
