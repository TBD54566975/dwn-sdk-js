import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import emailProtocolDefinition from '../../../vectors/protocol-definitions/email.json' assert { type: 'json' };

import type { GenerateProtocolsConfigureOutput } from '../../../utils/test-data-generator.js';
import type { ProtocolsConfigureDescriptor } from '../../../../src/interfaces/protocols/types.js';

import { DataStoreLevel } from '../../../../src/store/data-store-level.js';
import { DidKeyResolver } from '../../../../src/did/did-key-resolver.js';
import { EventLogLevel } from '../../../../src/event-log/event-log-level.js';
import { GeneralJwsSigner } from '../../../../src/jose/jws/general/signer.js';
import { lexicographicalCompare } from '../../../../src/utils/string.js';
import { Message } from '../../../../src/core/message.js';
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

      // insert three messages into DB
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

    it('should return protocols with normalized URIs matching the query', async () => {
      const alice = await TestDataGenerator.generatePersona();

      // setting up a stub method resolver
      TestStubGenerator.stubDidResolver(didResolver, [alice]);

      // configure several protocols, all matching `example.com`
      const protocolDefinition = emailProtocolDefinition;
      const protocol1 = await TestDataGenerator.generateProtocolsConfigure({
        requester : alice,
        protocol  : 'example.com',
        protocolDefinition
      });
      const protocolTrailingSlash = await TestDataGenerator.generateProtocolsConfigure({
        requester : alice,
        protocol  : 'example.com/',
        protocolDefinition
      });
      const protocolParams = await TestDataGenerator.generateProtocolsConfigure({
        requester : alice,
        protocol  : 'example.com/?foo=bar',
        protocolDefinition
      });
      const protocolCapitalized = await TestDataGenerator.generateProtocolsConfigure({
        requester : alice,
        protocol  : 'EXAMPLE.Com',
        protocolDefinition
      });

      // Sort messages into lexicographic order. We only allow protocol overwrites if the new message CID
      // has higher lexicographic value.
      const equivalentProtocols = [protocol1, protocolTrailingSlash, protocolParams, protocolCapitalized];
      let messageDataWithCid: (GenerateProtocolsConfigureOutput & { cid: string })[] = [];
      for (const messageData of equivalentProtocols) {
        const cid = await Message.getCid(messageData.message);
        messageDataWithCid.push({ cid, ...messageData });
      }

      messageDataWithCid.sort((messageDataA, messageDataB) => {
        return lexicographicalCompare(messageDataA.cid, messageDataB.cid);
      });

      // Configure protocols. Each one overwrites the previous
      for (const protocol of messageDataWithCid) {
        const configureReply = await dwn.processMessage(alice.did, protocol.message, protocol.dataStream);
        expect(configureReply.status.code).to.equal(202);
      }

      // configure several more protocols, none of which match `example.com`
      const protocolSlashFoo = await TestDataGenerator.generateProtocolsConfigure({ requester: alice, protocol: 'example.com/foo' });
      const protocolSubdomainFoo = await TestDataGenerator.generateProtocolsConfigure({ requester: alice, protocol: 'foo.example.com' });

      for (const protocol of [protocolSlashFoo, protocolSubdomainFoo]) {
        const configureReply = await dwn.processMessage(alice.did, protocol.message, protocol.dataStream);
        expect(configureReply.status.code).to.equal(202);
      }

      // query for protocols that match `example.com`
      const queryMessageData = await TestDataGenerator.generateProtocolsQuery({
        requester : alice,
        filter    : { protocol: protocol1.message.descriptor.protocol }
      });

      const reply = await dwn.processMessage(alice.did, queryMessageData.message);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(1);

      const resultProtocols = reply.entries!.map(entry =>
        (entry.descriptor as ProtocolsConfigureDescriptor).protocol
      );

      // Expect equivalent protocol with highest lexicographic value to remain
      expect(resultProtocols).to.contain(
        messageDataWithCid[messageDataWithCid.length-1].message.descriptor.protocol
      );

      // Expect URIs with subdomains, different capitalization, and different path to be excluded
      expect(resultProtocols).not.to.contain(protocolSlashFoo.message.descriptor.protocol);
      expect(resultProtocols).not.to.contain(protocolSubdomainFoo.message.descriptor.protocol);
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
