import type { DidResolver } from '@web5/dids';
import type { EventStream } from '../../src/types/subscriptions.js';
import type { ResumableTask } from '../../src/core/resumable-task-manager.js';
import type { DataStore, EventLog, MessageStore, ResumableTaskStore } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import EventEmitter from 'events';
import minimalProtocolDefinition from '../vectors/protocol-definitions/minimal.json' assert { type: 'json' };
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DataStream } from '../../src/utils/data-stream.js';
import { Dwn } from '../../src/dwn.js';
import { Jws } from '../../src/utils/jws.js';
import { RecordsRead } from '../../src/interfaces/records-read.js';
import { RecordsWrite } from '../../src/interfaces/records-write.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { useFakeTimers } from 'sinon';
import { DidKey, UniversalResolver } from '@web5/dids';
import { ProtocolsConfigure, RecordsDelete } from '../../src/index.js';
import { ResumableTaskManager, ResumableTaskName } from '../../src/core/resumable-task-manager.js';

chai.use(chaiAsPromised);

export function testResumableTasks(): void {
  describe('resumable tasks', async () => {
    let clock: sinon.SinonFakeTimers;
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
      sinon.restore(); // wipe all previous stubs/spies/mocks/fakes/clock
      clock = useFakeTimers({ shouldAdvanceTime: true }); // IMPORTANT: MUST be called AFTER `sinon.restore()` because `sinon.restore()`

      // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
      await messageStore.clear();
      await dataStore.clear();
      await resumableTaskStore.clear();
      await eventLog.clear();
    });

    afterEach(async () => {
      if (clock !== undefined) {
        clock.restore(); // IMPORTANT: MUST be called, else some clock tests the heavily rely on timers and event emitters may hang forever.
      }
    });

    after(async () => {
      await dwn.close();
    });

    it('should resume tasks that are not completed upon start of the DWN', async () => {
      // Scenario: DWN has a `RecordsDelete` task that is not completed, it should resume the task upon restart
      // 1. Write a record to DWN (for deletion later).
      // 2. Insert a resumable `RecordDelete` task into the resumable task store bypassing message handler to avoid it being processed.
      // 3. Restart the DWN to trigger the resumable task to be resumed.
      // 4. Verify that the record is deleted.

      const alice = await TestDataGenerator.generateDidKeyPersona();

      // install a protocol to allow records to be written
      const protocolDefinition = minimalProtocolDefinition;
      const protocolsConfig = await ProtocolsConfigure.create({
        definition : protocolDefinition,
        signer     : Jws.createSigner(alice)
      });
      const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
      expect(protocolsConfigureReply.status.code).to.equal(202);

      // 1. Write a record to DWN (for deletion later).
      const data = TestDataGenerator.randomBytes(100);
      const messageOptions = {
        signer       : Jws.createSigner(alice),
        protocol     : protocolDefinition.protocol,
        protocolPath : 'foo',
        dataFormat   : 'any-data-format',
        data         : data
      };

      const recordsWrite = await RecordsWrite.create(messageOptions);
      const recordsWriteResponse = await dwn.processMessage(alice.did, recordsWrite.message, { dataStream: DataStream.fromBytes(data) });
      expect(recordsWriteResponse.status.code).equals(202);

      // 2. Insert a resumable `RecordDelete` task into the resumable task store bypassing message handler to avoid it being processed.

      // IMPORTANT!!! This is to avoid `RecordsDelete` having the same timestamp as `RecordsWrite` which causes the delete to be disgarded.
      await clock.tickAsync(1);
      const recordsDelete = await RecordsDelete.create({
        recordId : recordsWrite.message.recordId,
        prune    : true,
        signer   : Jws.createSigner(alice)
      });

      const resumableTask: ResumableTask = {
        name : ResumableTaskName.RecordsDelete,
        data : {
          tenant  : alice.did,
          message : recordsDelete.message
        }
      };
      await resumableTaskStore.register(resumableTask, 0); // 0 timeout to ensure it immediately times out for resuming

      // sanity check that the record is still there
      const recordsRead = await RecordsRead.create({
        signer : Jws.createSigner(alice),
        filter : { recordId: recordsWrite.message.recordId }
      });

      const readReply = await dwn.processMessage(alice.did, recordsRead.message);
      expect(readReply.status.code).to.equal(200);
      expect(readReply.record).to.exist;

      // 3. Restart the DWN to trigger the resumable task to be resumed.
      await dwn.close();
      await dwn.open();

      // 4. Verify that the record is deleted.
      const readReply2 = await dwn.processMessage(alice.did, recordsRead.message);
      expect(readReply2.status.code).to.equal(404);
      expect(readReply2.record).to.be.undefined;
    });

    it('should extend long running tasks automatically to prevent it from timing out', async () => {
      // Scenario: DWN is executing a long running `RecordsDelete`, it extends the timeout automatically to prevent it from timing out
      // 1. Mock code to never complete the `RecordsDelete` until given a signal to complete.
      // 2. Write a record to DWN.
      // 3. Submit a `RecordsDelete` without awaiting on its completion.
      // 4. Verify that the task timeout is automatically extended.
      // 5. Signal the mocked code to complete the `RecordsDelete`.
      // 6. Verify that automatic timeout extension loop is cleared.
      // 7. Verify that the resumable task is deleted.

      const alice = await TestDataGenerator.generateDidKeyPersona();

      // install a protocol to allow records to be written
      const protocolDefinition = minimalProtocolDefinition;
      const protocolsConfig = await ProtocolsConfigure.create({
        definition : protocolDefinition,
        signer     : Jws.createSigner(alice)
      });
      const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
      expect(protocolsConfigureReply.status.code).to.equal(202);

      // 1. Mock code to never complete the `RecordsDelete` until given a signal to complete.
      const completeDeleteSignal = new EventEmitter();
      const completeDeletePromise = new Promise((resolve) => {
        completeDeleteSignal.once('complete-delete', resolve);
      });
      sinon.stub(dwn['storageController'], 'performRecordsDelete').callsFake(async () => {
        await completeDeletePromise;
      });

      // 2. Write a record to DWN.
      const data = TestDataGenerator.randomBytes(100);
      const messageOptions = {
        signer       : Jws.createSigner(alice),
        protocol     : protocolDefinition.protocol,
        protocolPath : 'foo',
        dataFormat   : 'any-data-format',
        data         : data
      };

      const recordsWrite = await RecordsWrite.create(messageOptions);
      const recordsWriteResponse = await dwn.processMessage(alice.did, recordsWrite.message, { dataStream: DataStream.fromBytes(data) });
      expect(recordsWriteResponse.status.code).equals(202);

      // 3. Submit a `RecordsDelete` without awaiting on its completion.
      const resumableTaskRegisterSpy = sinon.spy(resumableTaskStore, 'register');
      const clearTimeoutExtensionTimerSpy = sinon.spy(ResumableTaskManager, 'clearTimeoutExtensionTimer');

      // IMPORTANT!!! This is to avoid `RecordsDelete` having the same timestamp as `RecordsWrite` which causes the delete to be disgarded.
      await clock.tickAsync(1);
      const recordsDelete = await RecordsDelete.create({
        recordId : recordsWrite.message.recordId,
        prune    : true,
        signer   : Jws.createSigner(alice)
      });

      let isDeleteComplete = false;
      const recordsDeletePromise = dwn.processMessage(alice.did, recordsDelete.message).then(() => isDeleteComplete = true);

      // wait until the resumable `RecordsDelete` task is registered
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (resumableTaskRegisterSpy.called) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      });
      const initialResumableTaskState = await resumableTaskRegisterSpy.firstCall.returnValue;

      // 4. Verify that the task timeout is automatically extended.
      await clock.tickAsync(ResumableTaskManager.timeoutExtensionFrequencyInSeconds * 2 * 1000); // advancing time up to 2 extension cycles
      // IMPORTANT: This call ensure all scheduled timers are executed
      // In theory calling `tickAsync()` or `runToLastAsync()` alone should execute all scheduled timers
      // but for some reason this behavior does not happen ONLY in Safari.
      // a work-around that I found right now is to call BOTH `tickAsync()` and `runToLastAsync()`.
      await clock.runToLastAsync();

      let latestResumableTaskState = await resumableTaskStore.read(initialResumableTaskState.id);
      expect(latestResumableTaskState!.timeout).to.be.greaterThan(initialResumableTaskState.timeout);

      // 5. Signal the mocked code to complete the `RecordsDelete`.
      completeDeleteSignal.emit('complete-delete');

      // wait until the `RecordsDelete` is completed
      await recordsDeletePromise;
      expect(isDeleteComplete).to.be.true;

      // 6. Verify that automatic timeout extension loop is cleared.
      expect(clearTimeoutExtensionTimerSpy.calledOnce).to.be.true;

      // 7. Verify that the resumable task is deleted.
      latestResumableTaskState = await resumableTaskStore.read(initialResumableTaskState.id);
      expect(latestResumableTaskState).to.be.undefined;
    });
  });
}
