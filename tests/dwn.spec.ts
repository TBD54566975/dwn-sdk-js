import type { DidResolver } from '@web5/dids';
import type { EventStream } from '../src/types/subscriptions.js';
import type { ActiveTenantCheckResult, EventsQueryReply, TenantGate } from '../src/index.js';
import type { DataStore, EventLog, MessageStore, ResumableTaskStore } from '../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { Dwn } from '../src/dwn.js';
import { Message } from '../src/core/message.js';
import { stubInterface } from 'ts-sinon';
import { TestDataGenerator } from './utils/test-data-generator.js';
import { TestEventStream } from './test-event-stream.js';
import { TestStores } from './test-stores.js';
import { DidKey, UniversalResolver } from '@web5/dids';

chai.use(chaiAsPromised);

export function testDwnClass(): void {
  describe('DWN', () => {
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
      sinon.restore(); // wipe all stubs/spies/mocks/fakes from previous test

      await messageStore.clear(); // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
    });

    after(async () => {
      await dwn.close();
    });

    describe('processMessage()', () => {
      it('should process RecordsWrite message signed by a `did:key` DID', async () => {
      // generate a `did:key` DID
        const alice = await TestDataGenerator.generateDidKeyPersona();

        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({
          author: alice,
        });

        const reply = await dwn.processMessage(alice.did, message, { dataStream });

        expect(reply.status.code).to.equal(202);
      });

      it('should process RecordsQuery message', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const { author, message } = await TestDataGenerator.generateRecordsQuery({ author: alice });

        const tenant = author!.did;
        const reply = await dwn.processMessage(tenant, message);

        expect(reply.status.code).to.equal(200);
        expect(reply.entries).to.be.empty;
      });

      it('should process an EventsQuery message', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const { message } = await TestDataGenerator.generateEventsQuery({ author: alice });

        const reply: EventsQueryReply = await dwn.processMessage(alice.did, message);

        expect(reply.status.code).to.equal(200);
        expect(reply.entries).to.be.empty;
        expect((reply as any).data).to.not.exist;
      });

      it('#191 - regression - should run JSON schema validation', async () => {
        const invalidMessage = {
          descriptor: {
            interface        : 'Records',
            method           : 'Read',
            messageTimestamp : '2023-07-25T10:20:30.123456Z'
          },
          authorization: {}
        };

        const validateJsonSchemaSpy = sinon.spy(Message, 'validateJsonSchema');

        const alice = await TestDataGenerator.generateDidKeyPersona();
        const reply = await dwn.processMessage(alice.did, invalidMessage);

        sinon.assert.calledOnce(validateJsonSchemaSpy);

        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain(`must have required property 'filter'`);
      });

      it('should throw 400 if given no interface or method found in message', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const reply1 = await dwn.processMessage(alice.did, undefined ); // missing message entirely, thus missing both `interface` and `method`
        expect(reply1.status.code).to.equal(400);
        expect(reply1.status.detail).to.contain('Both interface and method must be present');

        const reply2 = await dwn.processMessage(alice.did, { descriptor: { method: 'anyValue' } }); // missing `interface`
        expect(reply2.status.code).to.equal(400);
        expect(reply2.status.detail).to.contain('Both interface and method must be present');

        const reply3 = await dwn.processMessage(alice.did, { descriptor: { interface: 'anyValue' } }); // missing `method`
        expect(reply3.status.code).to.equal(400);
        expect(reply3.status.detail).to.contain('Both interface and method must be present');
      });

      it('should throw 401 if message is targeted at a non active tenant', async () => {
      // tenant gate that blocks everyone
        const blockAllTenantGate: TenantGate = {
          async isActiveTenant(): Promise<ActiveTenantCheckResult> {
            return { isActiveTenant: false };
          }
        };

        const messageStoreStub = stubInterface<MessageStore>();
        const dataStoreStub = stubInterface<DataStore>();
        const resumableTaskStoreStub = stubInterface<ResumableTaskStore>();
        const eventLogStub = stubInterface<EventLog>();
        const eventStreamStub = stubInterface<EventStream>();

        const dwnWithConfig = await Dwn.create({
          tenantGate         : blockAllTenantGate,
          messageStore       : messageStoreStub,
          dataStore          : dataStoreStub,
          resumableTaskStore : resumableTaskStoreStub,
          eventLog           : eventLogStub,
          eventStream        : eventStreamStub
        });

        const alice = await TestDataGenerator.generateDidKeyPersona();
        const { author, message } = await TestDataGenerator.generateRecordsQuery({ author: alice });

        const tenant = author!.did;
        const reply = await dwnWithConfig.processMessage(tenant, message);

        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain('not an active tenant');
      });

      it('should throw 401 with custom message from tenant gate if provided', async () => {
        // tenant gate that blocks everyone with a custom message
        const customMessage = 'a custom not-an-active-tenant message';
        const blockAllTenantGate: TenantGate = {
          async isActiveTenant(): Promise<ActiveTenantCheckResult> {
            return { isActiveTenant: false, detail: customMessage };
          }
        };

        const messageStoreStub = stubInterface<MessageStore>();
        const dataStoreStub = stubInterface<DataStore>();
        const resumableTaskStoreStub = stubInterface<ResumableTaskStore>();
        const eventLogStub = stubInterface<EventLog>();
        const eventStreamStub = stubInterface<EventStream>();

        const dwnWithConfig = await Dwn.create({
          tenantGate         : blockAllTenantGate,
          messageStore       : messageStoreStub,
          dataStore          : dataStoreStub,
          resumableTaskStore : resumableTaskStoreStub,
          eventLog           : eventLogStub,
          eventStream        : eventStreamStub
        });

        const alice = await TestDataGenerator.generateDidKeyPersona();
        const { author, message } = await TestDataGenerator.generateRecordsQuery({ author: alice });

        const tenant = author!.did;
        const reply = await dwnWithConfig.processMessage(tenant, message);

        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.equal(customMessage);
      });
    });
  });
}
