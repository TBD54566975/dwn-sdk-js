import type { DerivedPrivateJwk } from '../src/utils/hd-key.js';
import type { DataStore, EventLog, MessageStore, ProtocolDefinition, ProtocolsConfigureMessage, RecordsReadReply } from '../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import threadRoleProtocolDefinition from './vectors/protocol-definitions/thread-role.json' assert { type: 'json' };

import { authenticate } from '../src/core/auth.js';
import { DidKeyResolver } from '../src/did/did-key-resolver.js';
import { Encoder } from '../src/index.js';
import { HdKey } from '../src/utils/hd-key.js';
import { KeyDerivationScheme } from '../src/utils/hd-key.js';
import { TestDataGenerator } from './utils/test-data-generator.js';
import { TestStores } from './test-stores.js';
import { TestStubGenerator } from './utils/test-stub-generator.js';

import chai, { expect } from 'chai';
import { DataStream, DidResolver, Dwn, Jws, Protocols, ProtocolsConfigure, ProtocolsQuery, Records, RecordsRead } from '../src/index.js';

chai.use(chaiAsPromised);

export function testEndToEndScenarios(): void {
  describe('End-to-end Scenarios Spanning Features', () => {
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let eventLog: EventLog;
    let dwn: Dwn;

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

    it('should support a multi-participant encrypted chat protocol', async () => {
      // Scenario:
      // 1. Alice starts a chat thread
      // 2. Alice adds Bob as a participant with [symmetric key] encrypted using [Bob's participant-level public key]
      // 3. Alice writes a chat message(s) in the thread
      // 4. Alice sends an invite to Bob's DWN with the [context/thread ID]
      // 5. Bob fetches the invite from his DWN and obtains the [context/thread ID]
      // 6. Bob fetches the entire thread using the [context/thread ID]
      // 7. Bob is able to decrypt all thread content

      // creating Alice and Bob persona and setting up a stub DID resolver
      const alice = await TestDataGenerator.generatePersona();
      const bob = await TestDataGenerator.generatePersona();
      TestStubGenerator.stubDidResolver(didResolver, [alice, bob]);

      const protocolDefinition: ProtocolDefinition = threadRoleProtocolDefinition as ProtocolDefinition;

      // Alice configures chat protocol with encryption
      const protocolDefinitionForAlice
        = await Protocols.deriveAndInjectPublicEncryptionKeys(protocolDefinition, alice.keyId, alice.keyPair.privateJwk);
      const protocolsConfigureForAlice = await TestDataGenerator.generateProtocolsConfigure({
        author             : alice,
        protocolDefinition : protocolDefinitionForAlice
      });

      const protocolsConfigureForAliceReply = await dwn.processMessage(
        alice.did,
        protocolsConfigureForAlice.message
      );
      expect(protocolsConfigureForAliceReply.status.code).to.equal(202);

      // Bob configures chat protocol with encryption
      const protocolDefinitionForBob
        = await Protocols.deriveAndInjectPublicEncryptionKeys(protocolDefinition, bob.keyId, bob.keyPair.privateJwk);
      const protocolsConfigureForBob = await TestDataGenerator.generateProtocolsConfigure({
        author             : bob,
        protocolDefinition : protocolDefinitionForBob
      });

      const protocolsConfigureReply = await dwn.processMessage(bob.did, protocolsConfigureForBob.message);
      expect(protocolsConfigureReply.status.code).to.equal(202);

      // 1. Alice starts a chat thread writing to her own DWN
      const threadBytes = Encoder.objectToBytes({ title: 'Top Secret' });
      const threadRecord = await TestDataGenerator.generateProtocolEncryptedRecordsWrite({
        plaintextBytes                                   : threadBytes,
        author                                           : alice,
        protocolDefinition                               : protocolDefinition,
        protocolPath                                     : 'thread',
        encryptSymmetricKeyWithProtocolPathDerivedKey    : false,
        encryptSymmetricKeyWithProtocolContextDerivedKey : true
      });
      const threadRecordReply1 = await dwn.processMessage(alice.did, threadRecord.message, threadRecord.dataStream);
      expect(threadRecordReply1.status.code).to.equal(202);

      // 2. Alice adds Bob as a participant giving him the [context-derived private key] encrypted using [Bob's participant-level public key]

      // the context-derived key to be used for encrypting symmetric keys
      const aliceRootKey = {
        rootKeyId         : alice.keyId,
        derivationScheme  : KeyDerivationScheme.ProtocolContext,
        derivedPrivateKey : alice.keyPair.privateJwk
      };
      const contextDerivationPath = Records.constructKeyDerivationPathUsingProtocolContextScheme(threadRecord.message.contextId);
      const contextDerivedPrivateKey: DerivedPrivateJwk = await HdKey.derivePrivateKey(aliceRootKey, contextDerivationPath);
      const contextDerivedPublicKey = threadRecord.encryptionInput.keyEncryptionInputs[0].publicKey;

      // Alice queries Bob's DWN for Bob's chat protocol definition containing public key declarations
      const protocolsQuery = await ProtocolsQuery.create({
        filter: { protocol: threadRoleProtocolDefinition.protocol }
      });
      const protocolsQueryReply = await dwn.processMessage(bob.did, protocolsQuery.message);
      const protocolConfigureMessageOfBobFetched = protocolsQueryReply.entries![0] as ProtocolsConfigureMessage;

      // Alice verifies that the chat protocol definition is authored by Bob
      await authenticate(protocolConfigureMessageOfBobFetched.authorization, didResolver);
      const protocolsConfigureOfBobFetched = await ProtocolsConfigure.parse(protocolConfigureMessageOfBobFetched);
      expect(protocolsConfigureOfBobFetched.author).to.equal(bob.did);

      // generate the encrypted participant record using Bob's protocol configuration fetched
      const participantBobRecord = await TestDataGenerator.generateProtocolEncryptedRecordsWrite({
        plaintextBytes                                   : Encoder.objectToBytes(contextDerivedPrivateKey),
        author                                           : alice,
        recipient                                        : bob.did,
        protocolDefinition                               : protocolsConfigureOfBobFetched.message.descriptor.definition,
        protocolPath                                     : 'thread/participant',
        protocolContextId                                : threadRecord.message.contextId,
        protocolParentId                                 : threadRecord.message.recordId,
        encryptSymmetricKeyWithProtocolPathDerivedKey    : true,
        encryptSymmetricKeyWithProtocolContextDerivedKey : false // this could be `true` also, but mostly orthogonal to the scenario
      });
      const participantRecordReply = await dwn.processMessage(alice.did, participantBobRecord.message, participantBobRecord.dataStream);
      expect(participantRecordReply.status.code).to.equal(202);

      // 3. Alice writes a chat message(s) in the thread
      const messageByAlice = 'Message from Alice';
      const chatMessageByAlice = await TestDataGenerator.generateProtocolEncryptedRecordsWrite({
        plaintextBytes                                   : Encoder.stringToBytes(messageByAlice),
        author                                           : alice,
        recipient                                        : alice.did, // this is arguably irrelevant in multi-party communication
        protocolDefinition                               : protocolDefinition,
        protocolPath                                     : 'thread/chat',
        protocolContextId                                : threadRecord.message.contextId,
        protocolContextDerivingRootKeyId                 : aliceRootKey.rootKeyId,
        protocolContextDerivedPublicJwk                  : contextDerivedPublicKey,
        protocolParentId                                 : threadRecord.message.recordId,
        encryptSymmetricKeyWithProtocolPathDerivedKey    : false,
        encryptSymmetricKeyWithProtocolContextDerivedKey : true
      });
      const chatMessageReply = await dwn.processMessage(alice.did, chatMessageByAlice.message, chatMessageByAlice.dataStream);
      expect(chatMessageReply.status.code).to.equal(202);

      // Assume the below steps can be done since it is a common DWN usage pattern
      // 4. Alice sends an invite to Bob's DWN with the [context/thread ID]
      // 5. Bob fetches the invite from his DWN and obtains the [context/thread ID]

      // 6. Bob fetches the entire thread using the [context/thread ID]
      // Test that Bob is able to read his 'participant' role to obtain the context-derived private key for message decryption.
      // He doesn't need to invoke the role because recipients of a record are always authorized to read it
      const participantRead = await RecordsRead.create({
        signer : Jws.createSigner(bob),
        filter : {
          protocolPath : 'thread/participant',
          recipient    : bob.did,
          contextId    : threadRecord.message.contextId
        },
      });
      const participantReadReply = await dwn.processMessage(alice.did, participantRead.message) as RecordsReadReply;
      expect(participantReadReply.status.code).to.equal(200);

      // Test that Bob is able to read the thread root record
      const threadRead = await RecordsRead.create({
        signer : Jws.createSigner(bob),
        filter : {
          protocolPath : 'thread',
          contextId    : threadRecord.message.contextId
        },
        protocolRole: 'thread/participant'
      });
      const threadReadReply = await dwn.processMessage(alice.did, threadRead.message) as RecordsReadReply;
      expect(threadReadReply.status.code).to.equal(200);
      expect(threadReadReply.record).to.exist;

      // Test Bob can invoke his 'participant' role to read the chat message
      // TODO: #555 - We currently lack role-authorized RecordsQuery for a realistic scenario (https://github.com/TBD54566975/dwn-sdk-js/issues/555)
      const chatRead = await RecordsRead.create({
        signer : Jws.createSigner(bob),
        filter : {
          protocolPath : 'thread/chat',
          contextId    : threadRecord.message.contextId
        },
        protocolRole: 'thread/participant'
      });
      const chatReadReply = await dwn.processMessage(alice.did, chatRead.message) as RecordsReadReply;
      expect(chatReadReply.status.code).to.equal(200);
      expect(chatReadReply.record).to.exist;

      // 7. Bob is able to decrypt all thread content
      // Bob decrypts the participant message to obtain the context-derived private key
      const bobRootKey = {
        rootKeyId         : bob.keyId,
        derivationScheme  : KeyDerivationScheme.ProtocolPath,
        derivedPrivateKey : bob.keyPair.privateJwk
      };
      const participantRecordFetched = participantReadReply.record!;
      const encryptedContextDerivedPrivateKeyBytes = await DataStream.toBytes(participantRecordFetched.data); // to create streams for testing
      const derivationPathFromProtocolPath = Records.constructKeyDerivationPathUsingProtocolPathScheme(participantRecordFetched.descriptor);
      const bobProtocolPathDerivedPrivateKey = await HdKey.derivePrivateKey(bobRootKey, derivationPathFromProtocolPath);
      const decryptedContextDerivedKeyStream = await Records.decrypt(
        participantRecordFetched,
        bobProtocolPathDerivedPrivateKey,
        DataStream.fromBytes(encryptedContextDerivedPrivateKeyBytes)
      );
      const decryptedContextDerivedPrivateKey = await DataStream.toObject(decryptedContextDerivedKeyStream) as DerivedPrivateJwk;
      expect(decryptedContextDerivedPrivateKey).to.deep.equal(contextDerivedPrivateKey);

      // Arguably unrelated to the scenario, but let's sanity check that Bob's root key can also decrypt the encrypted context-derived private key
      const decryptedContextDerivedKeyStream2 = await Records.decrypt(
        participantRecordFetched,
        bobRootKey,
        DataStream.fromBytes(encryptedContextDerivedPrivateKeyBytes)
      );
      const decryptedContextDerivedPrivateKey2 = await DataStream.toObject(decryptedContextDerivedKeyStream2) as DerivedPrivateJwk;
      expect(decryptedContextDerivedPrivateKey2).to.deep.equal(contextDerivedPrivateKey);

      // Verify that Bob can now decrypt Alice's chat thread record using the decrypted context-derived key
      const decryptedChatThread = await Records.decrypt(
        threadReadReply.record!,
        decryptedContextDerivedPrivateKey,
        threadReadReply.record!.data
      );
      expect(await DataStream.toBytes(decryptedChatThread)).to.deep.equal(threadBytes);

      // Verify that Bob can now decrypt Alice's chat message using the decrypted context-derived key
      const encryptedChatMessageBytes = await DataStream.toBytes(chatReadReply.record!.data); // to create streams for testing
      const decryptedChatMessage = await Records.decrypt(
        chatReadReply.record!,
        decryptedContextDerivedPrivateKey,
        DataStream.fromBytes(encryptedChatMessageBytes)
      );
      expect(await DataStream.toBytes(decryptedChatMessage)).to.deep.equal(Encoder.stringToBytes(messageByAlice));

      // Arguably unrelated to the scenario, but let's also sanity check that Alice's root key can also decrypt the encrypted chat message
      const decryptedChatMessageStream2 = await Records.decrypt(
        chatReadReply.record!,
        aliceRootKey,
        DataStream.fromBytes(encryptedChatMessageBytes)
      );
      expect(await DataStream.toBytes(decryptedChatMessageStream2)).to.deep.equal(Encoder.stringToBytes(messageByAlice));
    });
  });
}