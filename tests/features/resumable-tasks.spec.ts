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
import { ProtocolsConfigure, RecordsDelete, RecordsQuery } from '../../src/index.js';
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

    it('should resume tasks that are not completed when DWN starts', async () => {
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

    it('should only resume tasks that are timed-out up to the batch size when DWN starts', async () => {
      // Scenario: DWN has multiple `RecordsDelete` tasks that are not completed,
      // it should grab tasks no greater than the batch size and only tasks that are timed-out.
      // 1. Set ResumableTaskManager.resumableTaskBatchSize to 2.
      // 2. Write 4 records to DWN (for deletion later).
      // 3. Insert a 4 resumable `RecordDelete` task into the resumable task store bypassing message handler to avoid it being processed:
      //    a. 1 task that is not timed-out (currently in-flight).
      //    b. 3 tasks that are already timed-out.
      // 4. Restart the DWN to trigger the resumable task to be resumed.
      // 5. Verify tasks were resumed in 2 batches (2 calls of `ResumableTaskStore.grab()`).
      // 6. Verify that 3 processed resumable tasks are deleted from resumable task store.
      // 7. Verify that only 1 record remains in the DWN.
      // 8. Set ResumableTaskManager.resumableTaskBatchSize back to original value.

      const alice = await TestDataGenerator.generateDidKeyPersona();

      // install a protocol to allow records to be written
      const protocolDefinition = minimalProtocolDefinition;
      const protocolsConfig = await ProtocolsConfigure.create({
        definition : protocolDefinition,
        signer     : Jws.createSigner(alice)
      });
      const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
      expect(protocolsConfigureReply.status.code).to.equal(202);

      // 1. Set ResumableTaskManager.resumableTaskBatchSize to 2.
      const originalResumableTaskBatchSize = dwn['resumableTaskManager']['resumableTaskBatchSize'];
      dwn['resumableTaskManager']['resumableTaskBatchSize'] = 2;

      // 2. Write 4 records to DWN (for deletion later).
      const recordsWrites = [];
      for (let i = 0; i < 4; i++) {
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

        recordsWrites.push(recordsWrite);
      }

      // 3. Insert a 4 resumable `RecordDelete` task into the resumable task store bypassing message handler to avoid it being processed:
      //    a. 1 task that is not timed-out (currently in-flight).
      //    b. 3 tasks that are already timed-out.

      // IMPORTANT!!! This is to avoid `RecordsDelete` having the same timestamp as `RecordsWrite` which causes the delete to be discarded.
      await clock.tickAsync(1);
      for (let i = 0; i < 4; i++) {
        const recordsDelete = await RecordsDelete.create({
          recordId : recordsWrites[i].message.recordId,
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
        await resumableTaskStore.register(resumableTask, i === 0 ? 1000 : 0); // 1000 second timeout for the first task, 0 timeout for the rest
      }

      // 4. Restart the DWN to trigger the resumable task to be resumed.
      const grabSpy = sinon.spy(resumableTaskStore, 'grab');
      await dwn.close();
      await dwn.open();

      // 5. Verify tasks were resumed in 2 batches (2 calls of `ResumableTaskStore.grab()`).
      expect(grabSpy.calledThrice).to.be.true;

      const resumeTaskBatch1 = await grabSpy.firstCall.returnValue;
      const resumeTaskBatch2 = await grabSpy.secondCall.returnValue;
      const resumeTaskBatch3 = await grabSpy.thirdCall.returnValue;
      expect(resumeTaskBatch1.length).to.equal(2);
      expect(resumeTaskBatch2.length).to.equal(1);
      expect(resumeTaskBatch3.length).to.equal(0);

      // 6. Verify that 3 processed resumable tasks are deleted from resumable task store.
      const [task2, task3] = resumeTaskBatch1;
      const [task4] = resumeTaskBatch2;
      expect(await resumableTaskStore.read(task2.id)).to.be.undefined;
      expect(await resumableTaskStore.read(task3.id)).to.be.undefined;
      expect(await resumableTaskStore.read(task4.id)).to.be.undefined;

      // 7. Verify that only 1 record remains in the DWN.
      const recordsQuery = await RecordsQuery.create({
        signer : Jws.createSigner(alice),
        filter : { protocol: protocolDefinition.protocol }
      });
      const recordsQueryResponse = await dwn.processMessage(alice.did, recordsQuery.message);
      expect(recordsQueryResponse.status.code).equals(200);
      expect(recordsQueryResponse.entries).to.have.lengthOf(1);
      expect(recordsQueryResponse.entries![0].recordId).to.equal(recordsWrites[0].message.recordId);

      // 8. Set ResumableTaskManager.resumableTaskBatchSize back to original value.
      dwn['resumableTaskManager']['resumableTaskBatchSize'] = originalResumableTaskBatchSize;
    });

    it('should continue to retry tasks that throw exceptions until success when DWN starts', async () => {
      // Scenario:
      // 1. Insert a 1 resumable `RecordDelete` task into the resumable task store bypassing message handler to avoid it being processed.
      // 2. Restart the DWN to trigger the resumable task to be resumed, force the task to throw an exception on the first attempt.
      // 3. Verify the task is retried until it succeeds.

      const alice = await TestDataGenerator.generateDidKeyPersona();

      // 1. Insert a 1 resumable `RecordDelete` task into the resumable task store bypassing message handler to avoid it being processed.
      const recordsDelete = await RecordsDelete.create({
        recordId : 'non-existent-record-id', // opportunistically testing non-existent record delete path
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

      // 2. Restart the DWN to trigger the resumable task to be resumed, force the task to throw an exception on the first attempt.
      const originalPerformRecordsDelete = dwn['storageController']['performRecordsDelete'].bind(dwn['storageController']);
      let attemptCount = 0;
      sinon.stub(dwn['storageController'], 'performRecordsDelete').callsFake(async (input) => {
        attemptCount++;

        if (attemptCount === 1) {
          throw new Error('This is fine, we deliberately force an error in the first attempt in this test.');
        }

        await originalPerformRecordsDelete(input);
      });

      await dwn.close();
      await dwn.open();

      // 3. Verify the task is retried until it succeeds.
      expect(attemptCount).to.equal(2);
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

      // IMPORTANT!!! This is to avoid `RecordsDelete` having the same timestamp as `RecordsWrite` which causes the delete to be discarded.
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
      // IMPORTANT: This call ensures all scheduled timers are executed
      // In theory calling `tickAsync()` or `runToLastAsync()` alone should execute all scheduled timers
      // but for some reason this behavior does not happen ONLY in Safari. I found 2o workarounds:
      // 1. call BOTH `tickAsync()` and `runToLastAsync()`.
      // 2. call `tickAsync()` with a longer time.
      // Chose the first workaround because it is should be the more reliable of the two.
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
