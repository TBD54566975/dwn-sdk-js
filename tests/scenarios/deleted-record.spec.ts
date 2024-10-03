import type { DidResolver } from '@web5/dids';
import type { EventStream } from '../../src/types/subscriptions.js';
import type { DataStore, EventLog, MessageStore, ResumableTaskStore } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import freeForAllProtocolDefinition from '../vectors/protocol-definitions/free-for-all.json' assert { type: 'json' };
import sinon from 'sinon';

import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { TestStubGenerator } from '../utils/test-stub-generator.js';

import chai, { expect } from 'chai';
import { DataStream, Dwn, Jws, ProtocolsConfigure, RecordsRead } from '../../src/index.js';
import { DidKey, UniversalResolver } from '@web5/dids';
import { Encoder, RecordsDelete, RecordsWrite } from '../../src/index.js';

chai.use(chaiAsPromised);

export function testDeletedRecordScenarios(): void {
  describe('End-to-end Scenarios Spanning Features', () => {
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

    it('should return the RecordsDelete and initial RecordsWrite when reading a deleted record', async () => {
      // Scenario:
      // 1. Alice deletes an existing record.
      // 2. Alice attempts to read the deleted record.
      // Expected outcome: Alice should get a 404 error with the reply containing the deleted record and the initial write of the record.

      // 0. Setting up a protocol and write a record
      const alice = await TestDataGenerator.generatePersona();
      TestStubGenerator.stubDidResolver(didResolver, [alice]);

      const protocolDefinition = freeForAllProtocolDefinition;
      const protocolsConfigure = await ProtocolsConfigure.create({
        signer     : Jws.createSigner(alice),
        definition : protocolDefinition
      });
      const protocolsConfigureForAliceReply = await dwn.processMessage(
        alice.did,
        protocolsConfigure.message
      );
      expect(protocolsConfigureForAliceReply.status.code).to.equal(202);

      const data = Encoder.stringToBytes('some post content');
      const { message: recordsWriteMessage } = await RecordsWrite.create({
        signer       : Jws.createSigner(alice),
        protocol     : protocolDefinition.protocol,
        protocolPath : 'post',
        schema       : protocolDefinition.types.post.schema,
        dataFormat   : protocolDefinition.types.post.dataFormats[0],
        data,
      });
      const writeReply = await dwn.processMessage(alice.did, recordsWriteMessage, { dataStream: DataStream.fromBytes(data) });
      expect(writeReply.status.code).to.equal(202);

      // 1. Alice deletes an existing record.
      const recordsDelete = await RecordsDelete.create({
        signer   : Jws.createSigner(alice),
        recordId : recordsWriteMessage.recordId
      });

      const deleteReply = await dwn.processMessage(alice.did, recordsDelete.message);
      expect(deleteReply.status.code).to.equal(202);

      // 2. Alice attempts to read the deleted record.
      const readData = await RecordsRead.create({
        signer : Jws.createSigner(alice),
        filter : { recordId: recordsWriteMessage.recordId }
      });
      const readReply = await dwn.processMessage(alice.did, readData.message);

      // Expected outcome: Alice should get a 404 error with the reply containing the deleted record and the initial write of the record.
      expect(readReply.status.code).to.equal(404);
      expect(readReply.delete).to.exist;
      expect(readReply.delete).to.deep.equal(recordsDelete.message);
      expect(readReply.initialWrite).to.exist;
      expect(readReply.initialWrite).to.deep.equal(recordsWriteMessage);
    });
  });
}