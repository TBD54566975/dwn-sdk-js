import type { GenerateProtocolsConfigureOutput } from '../../../utils/test-data-generator.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

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

describe('ProtocolsConfigureHandler.handle()', () => {
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

    it('should return 400 if more than 1 signature is provided in `authorization`', async () => {
      const { requester, message, protocolsConfigure } = await TestDataGenerator.generateProtocolsConfigure();
      const tenant = requester.did;

      // intentionally create more than one signature, which is not allowed
      const extraRandomPersona = await TestDataGenerator.generatePersona();
      const signatureInput1 = Jws.createSignatureInput(requester);
      const signatureInput2 = Jws.createSignatureInput(extraRandomPersona);

      const authorizationPayloadBytes = Encoder.objectToBytes(protocolsConfigure.authorizationPayload);

      const signer = await GeneralJwsSigner.create(authorizationPayloadBytes, [signatureInput1, signatureInput2]);
      message.authorization = signer.getJws();

      TestStubGenerator.stubDidResolver(didResolver, [requester]);

      const reply = await dwn.processMessage(tenant, message);

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain('expected no more than 1 signature');
    });

    it('should return 401 if auth fails', async () => {
      const alice = await DidKeyResolver.generate();
      alice.keyId = 'wrongValue'; // to fail authentication
      const { message } = await TestDataGenerator.generateProtocolsConfigure({ requester: alice });

      const reply = await dwn.processMessage(alice.did, message);
      expect(reply.status.code).to.equal(401);
      expect(reply.status.detail).to.contain('not a valid DID');
    });

    it('should only be able to overwrite existing protocol if new protocol is lexicographically larger', async () => {
      // generate three versions of the same protocol message
      const alice = await DidKeyResolver.generate();
      const protocol = 'exampleProtocol';
      const messageData1 = await TestDataGenerator.generateProtocolsConfigure({ requester: alice, protocol });
      const messageData2 = await TestDataGenerator.generateProtocolsConfigure({ requester: alice, protocol });
      const messageData3 = await TestDataGenerator.generateProtocolsConfigure({ requester: alice, protocol });

      const messageDataWithCid: (GenerateProtocolsConfigureOutput & { cid: string })[] = [];
      for (const messageData of [messageData1, messageData2, messageData3]) {
        const cid = await Message.getCid(messageData.message);
        messageDataWithCid.push({ cid, ...messageData });
      }

      // sort the message in lexicographic order
      const [
        oldestWrite,
        middleWrite,
        newestWrite
      ]: GenerateProtocolsConfigureOutput[]
        = messageDataWithCid.sort((messageDataA, messageDataB) => { return lexicographicalCompare(messageDataA.cid, messageDataB.cid); });

      // write the protocol with the middle lexicographic value
      let reply = await dwn.processMessage(alice.did, middleWrite.message, middleWrite.dataStream);
      expect(reply.status.code).to.equal(202);

      // test that the protocol with the smallest lexicographic value cannot be written
      reply = await dwn.processMessage(alice.did, oldestWrite.message, oldestWrite.dataStream);
      expect(reply.status.code).to.equal(409);

      // test that the protocol with the largest lexicographic value can be written
      reply = await dwn.processMessage(alice.did, newestWrite.message, newestWrite.dataStream);
      expect(reply.status.code).to.equal(202);

      // test that old protocol message is removed from DB and only the newer protocol message remains
      const queryMessageData = await TestDataGenerator.generateProtocolsQuery({ requester: alice, filter: { protocol } });
      reply = await dwn.processMessage(alice.did, queryMessageData.message);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(1);

      const initialDefinition = JSON.stringify(middleWrite.message.descriptor.definition);
      const expectedDefinition = JSON.stringify(newestWrite.message.descriptor.definition);
      const actualDefinition = JSON.stringify(reply.entries![0]['descriptor']['definition']);
      expect(actualDefinition).to.not.equal(initialDefinition);
      expect(actualDefinition).to.equal(expectedDefinition);
    });

    describe('event log', () => {
      it('should add event for ProtocolsConfigure', async () => {
        const alice = await DidKeyResolver.generate();
        const protocol = 'exampleProtocol';
        const { message, dataStream } = await TestDataGenerator.generateProtocolsConfigure({ requester: alice, protocol });

        const reply = await dwn.processMessage(alice.did, message, dataStream);
        expect(reply.status.code).to.equal(202);

        const events = await eventLog.getEvents(alice.did);
        expect(events.length).to.equal(1);

        const messageCid = await Message.getCid(message);
        expect(events[0].messageCid).to.equal(messageCid);
      });

      it('should delete older ProtocolsConfigure event when one overwritten', async () => {
        const alice = await DidKeyResolver.generate();
        const protocol = 'exampleProtocol';
        const messageData1 = await TestDataGenerator.generateProtocolsConfigure({ requester: alice, protocol });
        const messageData2 = await TestDataGenerator.generateProtocolsConfigure({ requester: alice, protocol });

        const messageDataWithCid: (GenerateProtocolsConfigureOutput & { cid: string })[] = [];
        for (const messageData of [messageData1, messageData2]) {
          const cid = await Message.getCid(messageData.message);
          messageDataWithCid.push({ cid, ...messageData });
        }

        // sort the message in lexicographic order
        const [oldestWrite, newestWrite]: GenerateProtocolsConfigureOutput[]
          = messageDataWithCid.sort((messageDataA, messageDataB) => { return lexicographicalCompare(messageDataA.cid, messageDataB.cid); });

        // write the protocol with the middle lexicographic value
        let reply = await dwn.processMessage(alice.did, oldestWrite.message, oldestWrite.dataStream);
        expect(reply.status.code).to.equal(202);

        // test that the protocol with the largest lexicographic value can be written
        reply = await dwn.processMessage(alice.did, newestWrite.message, newestWrite.dataStream);
        expect(reply.status.code).to.equal(202);

        const events = await eventLog.getEvents(alice.did);
        expect(events.length).to.equal(1);

        const newestMessageCid = await Message.getCid(newestWrite.message);
        expect(events[0].messageCid).to.equal(newestMessageCid);
      });
    });
  });
});
