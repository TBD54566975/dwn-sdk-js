import type { TenantGate } from '../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DataStoreLevel } from '../src/store/data-store-level.js';
import { DidKeyResolver } from '../src/did/did-key-resolver.js';
import { Dwn } from '../src/dwn.js';
import { EventLogLevel } from '../src/event-log/event-log-level.js';
import { Message } from '../src/core/message.js';
import { MessageStoreLevel } from '../src/store/message-store-level.js';
import { TestDataGenerator } from './utils/test-data-generator.js';

chai.use(chaiAsPromised);

describe('DWN', () => {
  let messageStore: MessageStoreLevel;
  let dataStore: DataStoreLevel;
  let eventLog: EventLogLevel;
  let dwn: Dwn;

  before(async () => {
    // important to follow this pattern to initialize the message store in tests
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

    dwn = await Dwn.create({ messageStore, dataStore, eventLog });
  });

  beforeEach(async () => {
    await messageStore.clear(); // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
  });

  after(async () => {
    await dwn.close();
  });

  describe('create()', () => {
    it('#224 - should be able to initialize a DWN with undefined config', async () => {
      const dwnWithoutConfig = await Dwn.create(); // without passing in a config
      const alice = await DidKeyResolver.generate();
      const { requester, message } = await TestDataGenerator.generateRecordsQuery({ requester: alice });

      const tenant = requester.did;
      const reply = await dwnWithoutConfig.processMessage(tenant, message);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries).to.be.empty;
    });
  });

  describe('processMessage()', () => {
    it('should process RecordsWrite message signed by a `did:key` DID', async () => {
      // generate a `did:key` DID
      const alice = await DidKeyResolver.generate();

      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({
        requester: alice,
      });

      const reply = await dwn.processMessage(alice.did, message, dataStream);

      expect(reply.status.code).to.equal(202);
    });

    it('should process RecordsQuery message', async () => {
      const alice = await DidKeyResolver.generate();
      const { requester, message } = await TestDataGenerator.generateRecordsQuery({ requester: alice });

      const tenant = requester.did;
      const reply = await dwn.processMessage(tenant, message);

      expect(reply.status.code).to.equal(200);
      expect(reply.entries).to.be.empty;
    });

    it('#191 - regression - should run JSON schema validation', async () => {
      const invalidMessage = {
        descriptor: {
          interface : 'Records',
          method    : 'Write',
        },
        authorization: {}
      };

      const validateJsonSchemaSpy = sinon.spy(Message, 'validateJsonSchema');

      const alice = await DidKeyResolver.generate();
      const reply = await dwn.processMessage(alice.did, invalidMessage);

      sinon.assert.calledOnce(validateJsonSchemaSpy);

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain(`must have required property 'recordId'`);
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

      const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);
      const dataStoreStub = sinon.createStubInstance(DataStoreLevel);
      const eventLogStub = sinon.createStubInstance(EventLogLevel);

      const dwnWithConfig = await Dwn.create({
        tenantGate   : blockAllTenantGate,
        messageStore : messageStoreStub,
        dataStore    : dataStoreStub,
        eventLog     : eventLogStub
      });

      const alice = await DidKeyResolver.generate();
      const { requester, message } = await TestDataGenerator.generateRecordsQuery({ requester: alice });

      const tenant = requester.did;
      const reply = await dwnWithConfig.processMessage(tenant, message);

      expect(reply.status.code).to.equal(401);
      expect(reply.status.detail).to.contain('not a tenant');
    });
  });
});
