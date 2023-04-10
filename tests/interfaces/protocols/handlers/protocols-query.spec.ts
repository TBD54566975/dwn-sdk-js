import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DataStoreLevel } from '../../../../src/store/data-store-level.js';
import { DidKeyResolver } from '../../../../src/did/did-key-resolver.js';
import { EventLogLevel } from '../../../../src/event-log/event-log-level.js';
import { GeneralJwsSigner } from '../../../../src/jose/jws/general/signer.js';
import { MessageStoreLevel } from '../../../../src/store/message-store-level.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import { TestStubGenerator } from '../../../utils/test-stub-generator.js';

import { DidResolver, Dwn, Encoder, Jws } from '../../../../src/index.js';

chai.use(chaiAsPromised);

describe('ProtocolsQueryHandler.handle()', () => {
  let didResolver: DidResolver;
  let messageStore: MessageStoreLevel;
  let dataStore: DataStoreLevel;
  let eventLog: EventLogLevel;
  let dwn: Dwn;

  describe('functional tests', () => {
    before(async () => {
      didResolver = new DidResolver([new DidKeyResolver()]);

      // important to follow this pattern to initialize and clean the message and data store in tests
      // so that different suites can reuse the same block store and index location for testing
      messageStore = new MessageStoreLevel({
        blockstoreLocation : 'TEST-MESSAGESTORE',
        indexLocation      : 'TEST-INDEX'
      });

      dataStore = new DataStoreLevel({
        blockstoreLocation: 'TEST-DATASTORE'
      });

      eventLog = new EventLogLevel({
        location: 'TEST-EVENTLOG'
      });

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
      const protocol1 = await TestDataGenerator.generateProtocolsConfigure({ requester: alice });
      const protocol2 = await TestDataGenerator.generateProtocolsConfigure({ requester: alice });
      const protocol3 = await TestDataGenerator.generateProtocolsConfigure({ requester: alice });

      await dwn.processMessage(alice.did, protocol1.message, protocol1.dataStream);
      await dwn.processMessage(alice.did, protocol2.message, protocol2.dataStream);
      await dwn.processMessage(alice.did, protocol3.message, protocol3.dataStream);

      // testing singular conditional query
      const queryMessageData = await TestDataGenerator.generateProtocolsQuery({
        requester : alice,
        filter    : { protocol: protocol1.message.descriptor.protocol }
      });

      const reply = await dwn.processMessage(alice.did, queryMessageData.message);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(1); // only 1 entry should match the query on protocol

      // testing fetch-all query without filter
      const queryMessageData2 = await TestDataGenerator.generateProtocolsQuery({
        requester: alice
      });

      const reply2 = await dwn.processMessage(alice.did, queryMessageData2.message);

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
      const signatureInput = Jws.createSignatureInput(requester);
      const signer = await GeneralJwsSigner.create(authorizationPayloadBytes, [signatureInput]);
      message.authorization = signer.getJws();

      const reply = await dwn.processMessage(tenant, message);

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain(`${incorrectDescriptorCid} does not match expected CID`);
    });

    it('should return 401 if auth fails', async () => {
      const alice = await DidKeyResolver.generate();
      alice.keyId = 'wrongValue'; // to fail authentication
      const { message } = await TestDataGenerator.generateProtocolsQuery({ requester: alice });

      const reply = await dwn.processMessage(alice.did, message);

      expect(reply.status.code).to.equal(401);
      expect(reply.status.detail).to.contain('not a valid DID');
    });
  });
});
