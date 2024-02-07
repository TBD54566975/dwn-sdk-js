import type { EventStream } from '../../src/types/subscriptions.js';
import type { DataStore, EventLog, MessageStore, ProtocolDefinition } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import dataSizeLimitProtocolDefinition from '../vectors/protocol-definitions/data-size-limit.json' assert { type: 'json' };
import sinon from 'sinon';

import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { TestStubGenerator } from '../utils/test-stub-generator.js';

import chai, { expect } from 'chai';
import { DidKey, DidResolver } from '@web5/dids';
import { Dwn, Protocols } from '../../src/index.js';

chai.use(chaiAsPromised);

export function testProtocolMessageSizeLimits(): void {
  describe('Protocol message size limits', () => {
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let eventLog: EventLog;
    let eventStream: EventStream;
    let dwn: Dwn;

    // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
    // so that different test suites can reuse the same backend store for testing
    before(async () => {
      didResolver = new DidResolver({ didResolvers: [DidKey] });

      const stores = TestStores.get();
      messageStore = stores.messageStore;
      dataStore = stores.dataStore;
      eventLog = stores.eventLog;
      eventStream = TestEventStream.get();

      dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog, eventStream });
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

    it('should enforce protocol message size limits', async () => {
      // Scenario:
      // Alice joins a size limited protocol
      // 1. Alice should be able to write a message that does not exceed the protocol message size limit
      // 2. Alice should not be able to write a message that exceeds the protocol message size limit

      // creating Alice and Bob persona and setting up a stub DID resolver
      const alice = await TestDataGenerator.generatePersona();
      TestStubGenerator.stubDidResolver(didResolver, [alice]);

      const protocolDefinition: ProtocolDefinition = dataSizeLimitProtocolDefinition as ProtocolDefinition;

      // Alice configures protocol with encryption
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

      // 1. Alice writes a message to her own DWN within data size limit
      const blobBytes = TestDataGenerator.randomBytes(1000);
      const blobRecord = await TestDataGenerator.generateProtocolEncryptedRecordsWrite({
        plaintextBytes                                   : blobBytes,
        author                                           : alice,
        protocolDefinition                               : protocolDefinition,
        protocolPath                                     : 'blob',
        encryptSymmetricKeyWithProtocolPathDerivedKey    : false,
        encryptSymmetricKeyWithProtocolContextDerivedKey : true
      });
      const blobRecordReply1 = await dwn.processMessage(alice.did, blobRecord.message, { dataStream: blobRecord.dataStream });
      expect(blobRecordReply1.status.code).to.equal(202);

      // 2. Alice writes a message to her own DWN exceeding data size limit
      const blobBytes2 = TestDataGenerator.randomBytes(1001);
      const blobRecord2 = await TestDataGenerator.generateProtocolEncryptedRecordsWrite({
        plaintextBytes                                   : blobBytes2,
        author                                           : alice,
        protocolDefinition                               : protocolDefinition,
        protocolPath                                     : 'blob',
        encryptSymmetricKeyWithProtocolPathDerivedKey    : false,
        encryptSymmetricKeyWithProtocolContextDerivedKey : true
      });
      const blobRecordReply2 = await dwn.processMessage(alice.did, blobRecord2.message, { dataStream: blobRecord2.dataStream });
      expect(blobRecordReply2.status.code).to.equal(400);

    });
  });
}