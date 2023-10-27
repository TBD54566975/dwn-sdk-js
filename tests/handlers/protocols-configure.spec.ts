import type { GenerateProtocolsConfigureOutput } from '../utils/test-data-generator.js';
import type {
  DataStore,
  EventLog,
  MessageStore
} from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import dexProtocolDefinition from '../vectors/protocol-definitions/dex.json' assert { type: 'json' };
import minimalProtocolDefinition from '../vectors/protocol-definitions/minimal.json' assert { type: 'json' };

import { DidKeyResolver } from '../../src/did/did-key-resolver.js';
import { GeneralJwsBuilder } from '../../src/jose/jws/general/builder.js';
import { lexicographicalCompare } from '../../src/utils/string.js';
import { Message } from '../../src/core/message.js';
import { minimalSleep } from '../../src/utils/time.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStores } from '../test-stores.js';
import { TestStubGenerator } from '../utils/test-stub-generator.js';

import { DidResolver, Dwn, DwnErrorCode, Encoder, Jws } from '../../src/index.js';

chai.use(chaiAsPromised);

export function testProtocolsConfigureHandler(): void {
  describe('ProtocolsConfigureHandler.handle()', () => {
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

        const stores = TestStores.get();
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

      it('should allow a protocol definition with schema or dataFormat omitted', async () => {
        const alice = await DidKeyResolver.generate();

        const protocolDefinition = minimalProtocolDefinition;
        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          author: alice,
          protocolDefinition,
        });

        const reply = await dwn.processMessage(alice.did, protocolsConfig.message);
        expect(reply.status.code).to.equal(202);
      });

      it('should return 400 if more than 1 signature is provided in `authorization`', async () => {
        const { author, message, protocolsConfigure } = await TestDataGenerator.generateProtocolsConfigure();
        const tenant = author.did;

        // intentionally create more than one signature, which is not allowed
        const extraRandomPersona = await TestDataGenerator.generatePersona();
        const signer1 = Jws.createSigner(author);
        const signer2 = Jws.createSigner(extraRandomPersona);

        const signerSignaturePayloadBytes = Encoder.objectToBytes(protocolsConfigure.signerSignaturePayload!);

        const jwsBuilder = await GeneralJwsBuilder.create(signerSignaturePayloadBytes, [signer1, signer2]);
        message.authorization = { authorSignature: jwsBuilder.getJws() };

        TestStubGenerator.stubDidResolver(didResolver, [author]);

        const reply = await dwn.processMessage(tenant, message);

        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain('expected no more than 1 signature');
      });

      it('should return 401 if auth fails', async () => {
        const alice = await DidKeyResolver.generate();
        alice.keyId = 'wrongValue'; // to fail authentication
        const { message } = await TestDataGenerator.generateProtocolsConfigure({ author: alice });

        const reply = await dwn.processMessage(alice.did, message);
        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain('not a valid DID');
      });

      it('should be able to overwrite existing protocol if timestamp is newer', async () => {
        const alice = await DidKeyResolver.generate();

        const protocolDefinition = minimalProtocolDefinition;

        const oldProtocolsConfigure = await TestDataGenerator.generateProtocolsConfigure({
          author: alice,
          protocolDefinition,
        });
        await minimalSleep();
        const middleProtocolsConfigure = await TestDataGenerator.generateProtocolsConfigure({
          author: alice,
          protocolDefinition,
        });

        // first ProtocolsConfigure
        const reply1 = await dwn.processMessage(alice.did, middleProtocolsConfigure.message);
        expect(reply1.status.code).to.equal(202);

        // older messages will not overwrite the existing
        const reply2 = await dwn.processMessage(alice.did, oldProtocolsConfigure.message);
        expect(reply2.status.code).to.equal(409);

        // newer message can overwrite the existing message
        const newProtocolsConfigure = await TestDataGenerator.generateProtocolsConfigure({
          author: alice,
          protocolDefinition,
        });
        const reply3 = await dwn.processMessage(alice.did, newProtocolsConfigure.message);
        expect(reply3.status.code).to.equal(202);

        // only the newest protocol should remain
        const queryMessageData = await TestDataGenerator.generateProtocolsQuery({
          author : alice,
          filter : { protocol: protocolDefinition.protocol }
        });
        const queryReply = await dwn.processMessage(alice.did, queryMessageData.message);

        expect(queryReply.status.code).to.equal(200);
        expect(queryReply.entries?.length).to.equal(1);
      });

      it('should only be able to overwrite existing protocol if new protocol is lexicographically larger and timestamps are identical', async () => {
        const alice = await DidKeyResolver.generate();

        // Alter each protocol slightly to create lexicographic difference between them
        const protocolDefinition1 = {
          ...minimalProtocolDefinition,
          types: { ...minimalProtocolDefinition.types, foo1: { dataFormats: ['bar1'] } }
        };
        const protocolDefinition2 = {
          ...minimalProtocolDefinition,
          types: { ...minimalProtocolDefinition.types, foo2: { dataFormats: ['bar2'] } }
        };
        const protocolDefinition3 = {
          ...minimalProtocolDefinition,
          types: { ...minimalProtocolDefinition.types, foo3: { dataFormats: ['bar3'] } }
        };

        // Create three `ProtocolsConfigure` with identical timestamp
        const messageData1 = await TestDataGenerator.generateProtocolsConfigure({
          author             : alice,
          protocolDefinition : protocolDefinition1
        });
        const messageData2 = await TestDataGenerator.generateProtocolsConfigure({
          author             : alice,
          protocolDefinition : protocolDefinition2,
          messageTimestamp   : messageData1.message.descriptor.messageTimestamp
        });
        const messageData3 = await TestDataGenerator.generateProtocolsConfigure({
          author             : alice,
          protocolDefinition : protocolDefinition3,
          messageTimestamp   : messageData1.message.descriptor.messageTimestamp
        });

        const messageDataWithCid: (GenerateProtocolsConfigureOutput & { cid: string })[] = [];
        for (const messageData of [messageData1, messageData2, messageData3]) {
          const cid = await Message.getCid(messageData.message);
          messageDataWithCid.push({ cid, ...messageData });
        }

        // sort the message in lexicographic order
        const [
          lowestProtocolsConfigure,
          middleProtocolsConfigure,
          highestProtocolsConfigure
        ]: GenerateProtocolsConfigureOutput[]
        = messageDataWithCid.sort((messageDataA, messageDataB) => { return lexicographicalCompare(messageDataA.cid, messageDataB.cid); });

        // write the protocol with the middle lexicographic value
        const reply1 = await dwn.processMessage(alice.did, middleProtocolsConfigure.message);
        expect(reply1.status.code).to.equal(202);

        // test that the protocol with the smallest lexicographic value cannot be written
        const reply2 = await dwn.processMessage(alice.did, lowestProtocolsConfigure.message);
        expect(reply2.status.code).to.equal(409);

        // test that the protocol with the largest lexicographic value can be written
        const reply3 = await dwn.processMessage(alice.did, highestProtocolsConfigure.message);
        expect(reply3.status.code).to.equal(202);

        // test that lower lexicographic protocol message is removed from DB and only the newer protocol message remains
        const queryMessageData = await TestDataGenerator.generateProtocolsQuery({
          author : alice,
          filter : { protocol: protocolDefinition1.protocol }
        });
        const queryReply = await dwn.processMessage(alice.did, queryMessageData.message);

        expect(queryReply.status.code).to.equal(200);
        expect(queryReply.entries?.length).to.equal(1);
      });

      it('should return 400 if protocol is not normalized', async () => {
        const alice = await DidKeyResolver.generate();

        // query for non-normalized protocol
        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          author             : alice,
          protocolDefinition : minimalProtocolDefinition
        });

        // overwrite protocol because #create auto-normalizes protocol
        protocolsConfig.message.descriptor.definition.protocol = 'example.com/';

        // Re-create auth because we altered the descriptor after signing
        protocolsConfig.message.authorization = await Message.createAuthorizationAsAuthor(
          protocolsConfig.message.descriptor,
          Jws.createSigner(alice)
        );

        // Send records write message
        const reply = await dwn.processMessage(alice.did, protocolsConfig.message);
        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain(DwnErrorCode.UrlProtocolNotNormalized);
      });

      it('should return 400 if schema is not normalized', async () => {
        const alice = await DidKeyResolver.generate();

        const protocolDefinition = dexProtocolDefinition;
        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          author: alice,
          protocolDefinition,
        });

        // overwrite schema because #create auto-normalizes schema
        protocolsConfig.message.descriptor.definition.types.ask.schema = 'ask';

        // Re-create auth because we altered the descriptor after signing
        protocolsConfig.message.authorization = await Message.createAuthorizationAsAuthor(
          protocolsConfig.message.descriptor,
          Jws.createSigner(alice)
        );

        // Send records write message
        const reply = await dwn.processMessage(alice.did, protocolsConfig.message);
        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain(DwnErrorCode.UrlSchemaNotNormalized);
      });

      it('rejects non-tenant non-granted ProtocolsConfigures with 401', async () => {
        // Bob tries to ProtocolsConfigure to Alice's DWN without a PermissionsGrant
        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();

        const protocolDefinition = dexProtocolDefinition;
        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          author: bob,
          protocolDefinition,
        });
        const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
        expect(protocolsConfigureReply.status.code).to.equal(401);
        expect(protocolsConfigureReply.status.detail).to.contain('message failed authorization');
      });

      describe('event log', () => {
        it('should add event for ProtocolsConfigure', async () => {
          const alice = await DidKeyResolver.generate();
          const { message } = await TestDataGenerator.generateProtocolsConfigure({ author: alice });

          const reply = await dwn.processMessage(alice.did, message);
          expect(reply.status.code).to.equal(202);

          const events = await eventLog.getEvents(alice.did);
          expect(events.length).to.equal(1);

          const messageCid = await Message.getCid(message);
          expect(events[0].messageCid).to.equal(messageCid);
        });

        it('should delete older ProtocolsConfigure events when one is overwritten', async () => {
          const alice = await DidKeyResolver.generate();
          const oldestWrite = await TestDataGenerator.generateProtocolsConfigure({ author: alice, protocolDefinition: minimalProtocolDefinition });
          await minimalSleep();
          const newestWrite = await TestDataGenerator.generateProtocolsConfigure({ author: alice, protocolDefinition: minimalProtocolDefinition });

          let reply = await dwn.processMessage(alice.did, oldestWrite.message);
          expect(reply.status.code).to.equal(202);

          reply = await dwn.processMessage(alice.did, newestWrite.message);
          expect(reply.status.code).to.equal(202);

          const events = await eventLog.getEvents(alice.did);
          expect(events.length).to.equal(1);

          const newestMessageCid = await Message.getCid(newestWrite.message);
          expect(events[0].messageCid).to.equal(newestMessageCid);
        });
      });
    });
  });
}