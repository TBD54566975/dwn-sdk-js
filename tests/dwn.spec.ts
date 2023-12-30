import type { DataStore, EventLog, MessageStore } from '../src/index.js';
import type { EventsGetReply, TenantGate } from '../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DidKeyResolver } from '../src/did/did-key-resolver.js';
import { Dwn } from '../src/dwn.js';
import { Message } from '../src/core/message.js';
import { stubInterface } from 'ts-sinon';
import { TestDataGenerator } from './utils/test-data-generator.js';
import { TestStores } from './test-stores.js';

chai.use(chaiAsPromised);

export function testDwnClass(): void {
  describe('DWN', () => {
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let eventLog: EventLog;
    let dwn: Dwn;

    // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
    // so that different test suites can reuse the same backend store for testing
    before(async () => {
      const stores = TestStores.get();
      messageStore = stores.messageStore;
      dataStore = stores.dataStore;
      eventLog = stores.eventLog;

      dwn = await Dwn.create({ messageStore, dataStore, eventLog });
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
        const alice = await DidKeyResolver.generate();

        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({
          author: alice,
        });

        const reply = await dwn.processMessage(alice.did, message, dataStream);

        expect(reply.status.code).to.equal(202);
      });

      it('should process RecordsQuery message', async () => {
        const alice = await DidKeyResolver.generate();
        const { author, message } = await TestDataGenerator.generateRecordsQuery({ author: alice });

        const tenant = author!.did;
        const reply = await dwn.processMessage(tenant, message);

        expect(reply.status.code).to.equal(200);
        expect(reply.entries).to.be.empty;
      });

      it('should process an EventsGet message', async () => {
        const alice = await DidKeyResolver.generate();
        const { message } = await TestDataGenerator.generateEventsGet({ author: alice });

        const reply: EventsGetReply = await dwn.processMessage(alice.did, message);

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

        const alice = await DidKeyResolver.generate();
        const reply = await dwn.processMessage(alice.did, invalidMessage);

        sinon.assert.calledOnce(validateJsonSchemaSpy);

        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain(`must have required property 'filter'`);
      });

      it('should throw 400 if given no interface or method found in message', async () => {
        const alice = await DidKeyResolver.generate();
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

      it('should throw 401 if message is targeted at a non-tenant', async () => {
      // tenant gate that blocks everyone
        const blockAllTenantGate: TenantGate = {
          async isTenant(): Promise<boolean> {
            return false;
          }
        };

        const messageStoreStub = stubInterface<MessageStore>();
        const dataStoreStub = stubInterface<DataStore>();
        const eventLogStub = stubInterface<EventLog>();

        const dwnWithConfig = await Dwn.create({
          tenantGate   : blockAllTenantGate,
          messageStore : messageStoreStub,
          dataStore    : dataStoreStub,
          eventLog     : eventLogStub
        });

        const alice = await DidKeyResolver.generate();
        const { author, message } = await TestDataGenerator.generateRecordsQuery({ author: alice });

        const tenant = author!.did;
        const reply = await dwnWithConfig.processMessage(tenant, message);

        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain('not a tenant');
      });
    });
  });
}
