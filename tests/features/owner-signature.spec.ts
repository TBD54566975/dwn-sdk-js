import type { DidResolver } from '@web5/dids';
import type { EventStream } from '../../src/types/subscriptions.js';
import type { DataStore, EventLog, MessageStore, ResumableTaskStore } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import minimalProtocolDefinition from '../vectors/protocol-definitions/minimal.json' assert { type: 'json' };
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { ArrayUtility } from '../../src/utils/array.js';
import { DataStream } from '../../src/utils/data-stream.js';
import { Dwn } from '../../src/dwn.js';
import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { Jws } from '../../src/utils/jws.js';
import { RecordsRead } from '../../src/interfaces/records-read.js';
import { RecordsWrite } from '../../src/interfaces/records-write.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { DidKey, UniversalResolver } from '@web5/dids';

chai.use(chaiAsPromised);

export function testOwnerSignature(): void {
  describe('owner signature', async () => {
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let resumableTaskStore: ResumableTaskStore;
    let eventLog: EventLog;
    let eventStream: EventStream;
    let dwn: Dwn;

    // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
    // so that different test suites can reuse the same backend store for testing
    before(async () => {
      didResolver = new UniversalResolver({ didResolvers: [DidKey] });

      const stores = TestStores.get();
      messageStore = stores.messageStore;
      dataStore = stores.dataStore;
      resumableTaskStore = stores.resumableTaskStore;
      eventLog = stores.eventLog;
      eventStream = TestEventStream.get();

      dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog, eventStream, resumableTaskStore });
    });

    beforeEach(async () => {
      sinon.restore(); // wipe all previous stubs/spies/mocks/fakes

      // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
      await messageStore.clear();
      await dataStore.clear();
      await resumableTaskStore.clear();
      await eventLog.clear();
    });

    after(async () => {
      await dwn.close();
    });

    it('should use `ownerSignature` for authorization when it is given - flat-space', async () => {
      // scenario: Alice fetch a message authored by Bob from Bob's DWN and retains (writes) it in her DWN
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();

      // Bob writes a message to his DWN
      const { message, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({ author: bob, published: true });
      const writeReply = await dwn.processMessage(bob.did, message, { dataStream });
      expect(writeReply.status.code).to.equal(202);

      // Alice fetches the message from Bob's DWN
      const recordsRead = await RecordsRead.create({
        filter : { recordId: message.recordId },
        signer : Jws.createSigner(alice)
      });

      const readReply = await dwn.processMessage(bob.did, recordsRead.message);
      expect(readReply.status.code).to.equal(200);
      expect(readReply.record).to.exist;
      expect(readReply.record?.descriptor).to.exist;

      // Alice augments Bob's message as an external owner
      const { data, ...messageFetched } = readReply.record!; // remove data from message
      const ownerSignedMessage = await RecordsWrite.parse(messageFetched);
      await ownerSignedMessage.signAsOwner(Jws.createSigner(alice));

      // Test that Alice can successfully retain/write Bob's message to her DWN
      const aliceDataStream = readReply.record!.data;
      const aliceWriteReply = await dwn.processMessage(alice.did, ownerSignedMessage.message, { dataStream: aliceDataStream });
      expect(aliceWriteReply.status.code).to.equal(202);

      // Test that Bob's message can be read from Alice's DWN
      const readReply2 = await dwn.processMessage(alice.did, recordsRead.message);
      expect(readReply2.status.code).to.equal(200);
      expect(readReply2.record).to.exist;
      expect(readReply2.record?.descriptor).to.exist;

      const dataFetched = await DataStream.toBytes(readReply2.record!.data!);
      expect(ArrayUtility.byteArraysEqual(dataFetched, dataBytes!)).to.be.true;
    });

    it('should use `ownerSignature` for authorization when it is given - protocol-space', async () => {
      // scenario: Alice and Bob both have the same protocol which does NOT allow external entities to write,
      // but Alice can store a message authored by Bob as a owner in her own DWN
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();

      const protocolDefinition = minimalProtocolDefinition;

      // Alice installs the protocol
      const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
        author: alice,
        protocolDefinition
      });
      const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
      expect(protocolsConfigureReply.status.code).to.equal(202);

      // Sanity test that Bob cannot write to a protocol record to Alice's DWN
      const bobRecordsWrite = await TestDataGenerator.generateRecordsWrite({
        author       : bob,
        protocol     : protocolDefinition.protocol,
        protocolPath : 'foo'
      });
      const recordsWriteReply = await dwn.processMessage(alice.did, bobRecordsWrite.message, { dataStream: bobRecordsWrite.dataStream });
      expect(recordsWriteReply.status.code).to.equal(401);

      // Skipping Alice fetching the message from Bob's DWN (as this is tested already in the flat-space test)

      // Alice augments Bob's message as an external owner
      const ownerSignedMessage = await RecordsWrite.parse(bobRecordsWrite.message);
      await ownerSignedMessage.signAsOwner(Jws.createSigner(alice));

      // Test that Alice can successfully retain/write Bob's message to her DWN
      const aliceDataStream = DataStream.fromBytes(bobRecordsWrite.dataBytes!);
      const aliceWriteReply = await dwn.processMessage(alice.did, ownerSignedMessage.message, { dataStream: aliceDataStream });
      expect(aliceWriteReply.status.code).to.equal(202);

      // Test that Bob's message can be read from Alice's DWN
      const recordsRead = await RecordsRead.create({
        filter : { recordId: bobRecordsWrite.message.recordId },
        signer : Jws.createSigner(alice)
      });
      const readReply = await dwn.processMessage(alice.did, recordsRead.message);
      expect(readReply.status.code).to.equal(200);
      expect(readReply.record).to.exist;
      expect(readReply.record?.descriptor).to.exist;

      const dataFetched = await DataStream.toBytes(readReply.record!.data!);
      expect(ArrayUtility.byteArraysEqual(dataFetched, bobRecordsWrite.dataBytes!)).to.be.true;
    });

    it('should throw if `ownerSignature` in `authorization` is mismatching with the tenant - flat-space', async () => {
      // scenario: Carol attempts to store a message with Alice being the owner, and should fail
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();
      const carol = await TestDataGenerator.generateDidKeyPersona();

      // Bob creates a message, we skip writing to bob's DWN because that's orthogonal to this test
      const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: bob, published: true });

      // Alice augments Bob's message as an external owner, we also skipping writing to Alice's DWN because that's also orthogonal to this test
      await recordsWrite.signAsOwner(Jws.createSigner(alice));

      // Test that Carol is not able to store the message Alice created
      const carolWriteReply = await dwn.processMessage(carol.did, recordsWrite.message, { dataStream });
      expect(carolWriteReply.status.code).to.equal(401);
      expect(carolWriteReply.status.detail).to.contain('RecordsWriteOwnerAndTenantMismatch');
    });

    it('should throw if `ownerSignature` in `authorization` is mismatching with the tenant - protocol-space', async () => {
      // scenario: Alice, Bob, and Carol all have the same protocol which does NOT allow external entities to write,
      // scenario: Carol attempts to store a message with Alice being the owner, and should fail
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();
      const carol = await TestDataGenerator.generateDidKeyPersona();

      const protocolDefinition = minimalProtocolDefinition;

      // Bob creates a message, we skip writing to Bob's DWN because that's orthogonal to this test
      const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
        author       : bob,
        protocol     : protocolDefinition.protocol,
        protocolPath : 'foo'
      });

      // Alice augments Bob's message as an external owner, we also skipping writing to Alice's DWN because that's also orthogonal to this test
      await recordsWrite.signAsOwner(Jws.createSigner(alice));

      // Carol installs the protocol
      const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
        author: carol,
        protocolDefinition
      });
      const protocolsConfigureReply = await dwn.processMessage(carol.did, protocolsConfig.message);
      expect(protocolsConfigureReply.status.code).to.equal(202);

      // Test that Carol is not able to store the message Alice created
      const carolWriteReply = await dwn.processMessage(carol.did, recordsWrite.message, { dataStream });
      expect(carolWriteReply.status.code).to.equal(401);
      expect(carolWriteReply.status.detail).to.contain('RecordsWriteOwnerAndTenantMismatch');
    });

    it('should throw if `ownerSignature` fails verification', async () => {
      // scenario: Malicious Bob attempts to retain an externally authored message in Alice's DWN by providing an invalid `ownerSignature`
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();

      // Bob creates a message, we skip writing to bob's DWN because that's orthogonal to this test
      const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: bob, published: true });

      // Bob pretends to be Alice by adding an invalid `ownerSignature`
      // We do this by creating a valid signature first then swap out with an invalid one
      await recordsWrite.signAsOwner(Jws.createSigner(alice));
      const bobSignature = recordsWrite.message.authorization.signature.signatures[0];
          recordsWrite.message.authorization.ownerSignature!.signatures[0].signature = bobSignature.signature; // invalid `ownerSignature`

          // Test that Bob is not able to store the message in Alice's DWN using an invalid `ownerSignature`
          const aliceWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, { dataStream });
          expect(aliceWriteReply.status.detail).to.contain(DwnErrorCode.GeneralJwsVerifierInvalidSignature);
    });
  });
}
