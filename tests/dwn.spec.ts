import type { DataStore, EventLog, MessageStore } from '../src/index.js';
import type { EventsGetReply, RecordsWriteMessage, TenantGate } from '../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DidKeyResolver } from '../src/did/did-key-resolver.js';
import { Dwn } from '../src/dwn.js';
import { Encoder } from '../src/index.js';
import { stubInterface } from 'ts-sinon';
import { TestDataGenerator } from './utils/test-data-generator.js';
import { TestStoreInitializer } from './test-store-initializer.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../src/core/message.js';
import { Jws, RecordsRead } from '../src/index.js';

chai.use(chaiAsPromised);

describe('DWN', () => {
  let messageStore: MessageStore;
  let dataStore: DataStore;
  let eventLog: EventLog;
  let dwn: Dwn;

  // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
  // so that different test suites can reuse the same backend store for testing
  before(async () => {
    const stores = TestStoreInitializer.initializeStores();
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

  describe('create()', () => {
    it('#224 - should be able to initialize a DWN with undefined config', async () => {
      const dwnWithoutConfig = await Dwn.create(); // without passing in a config
      const alice = await DidKeyResolver.generate();
      const { author, message } = await TestDataGenerator.generateRecordsQuery({ author: alice });

      const tenant = author!.did;
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
      expect(reply.events).to.be.empty;
      expect((reply as any).data).to.not.exist;
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

  describe('handleRecordsRead', () => {
    it('should return error if preprocessing checks fail', async () => {
      const alice = await DidKeyResolver.generate();

      const recordsRead = await RecordsRead.create({
        recordId                    : 'recordId-doesnt-matter',
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      });
      (recordsRead.message as any).descriptor.method = 'Write'; // Will cause interface and method check to fail
      const reply = await dwn.handleRecordsRead(alice.did, recordsRead.message);

      expect(reply.status.code).to.not.equal(200);
    });
  });

  describe('handleMessagesGet', () => {
    // increases test coverage :)
    it('runs successfully', async () => {
      const did = await DidKeyResolver.generate();
      const alice = await TestDataGenerator.generatePersona(did);
      const messageCids: string[] = [];

      const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
        author: alice
      });

      const messageCid = await Message.getCid(recordsWrite.message);
      messageCids.push(messageCid);

      const reply = await dwn.processMessage(alice.did, recordsWrite.toJSON(), dataStream);
      expect(reply.status.code).to.equal(202);

      const { messagesGet } = await TestDataGenerator.generateMessagesGet({
        author: alice,
        messageCids
      });

      const messagesGetReply = await dwn.handleMessagesGet(alice.did, messagesGet.message);
      expect(messagesGetReply.status.code).to.equal(200);
      expect(messagesGetReply.messages!.length).to.equal(messageCids.length);

      for (const messageReply of messagesGetReply.messages!) {
        expect(messageReply.messageCid).to.not.be.undefined;
        expect(messageReply.message).to.not.be.undefined;
        expect(messageCids).to.include(messageReply.messageCid);

        const cid = await Message.getCid(messageReply.message!);
        expect(messageReply.messageCid).to.equal(cid);
      }
    });

    it('should return error if preprocessing checks fail', async () => {
      const alice = await DidKeyResolver.generate();

      const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({
        author: alice
      });

      const messageCids = [await Message.getCid(recordsWrite.message)];
      const { messagesGet } = await TestDataGenerator.generateMessagesGet({
        author: alice,
        messageCids
      });
      (messagesGet.message as any).descriptor.interface = 'Protocols'; // Will cause interface and method check to fail
      const reply = await dwn.handleMessagesGet(alice.did, messagesGet.message);

      expect(reply.status.code).to.not.equal(200);
    });
  });

  describe('synchronizePrunedInitialRecordsWrite()', () => {
    it('should allow an initial `RecordsWrite` to be written without supplying data', async () => {
      const alice = await DidKeyResolver.generate();

      const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author: alice });

      // simulate synchronize of pruned initial `RecordsWrite`
      const reply = await dwn.synchronizePrunedInitialRecordsWrite(alice.did, recordsWrite.message);
      expect(reply.status.code).to.equal(202);

      // verify `RecordsWrite` inserted can be queried but without the data returned
      const recordsQueryMessageData = await TestDataGenerator.generateRecordsQuery({
        author : alice,
        filter : { recordId: recordsWrite.message.recordId }
      });
      const recordsQueryReply = await dwn.processMessage(alice.did, recordsQueryMessageData.message);

      expect(recordsQueryReply.status.code).to.equal(200);
      expect(recordsQueryReply.entries?.length).to.equal(1);
      expect(recordsQueryReply.entries![0].encodedData).to.not.exist;

      // generate and write a new `RecordsWrite` to overwrite the existing record
      const newDataBytes = Encoder.stringToBytes('new data');
      const newDataEncoded = Encoder.bytesToBase64Url(newDataBytes);
      const newRecordsWrite = await TestDataGenerator.generateFromRecordsWrite({
        author        : alice,
        existingWrite : recordsWrite,
        data          : newDataBytes
      });

      const newRecordsWriteReply = await dwn.processMessage(alice.did, newRecordsWrite.message, newRecordsWrite.dataStream);
      expect(newRecordsWriteReply.status.code).to.equal(202);

      // verify new `RecordsWrite` has overwritten the existing record with new data
      const newRecordsQueryReply = await dwn.processMessage(alice.did, recordsQueryMessageData.message);

      expect(newRecordsQueryReply.status.code).to.equal(200);
      expect(newRecordsQueryReply.entries?.length).to.equal(1);
      expect(newRecordsQueryReply.entries![0].encodedData).to.equal(newDataEncoded);
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
      const { message } = await TestDataGenerator.generateRecordsWrite({ author: alice });

      const reply = await dwnWithConfig.synchronizePrunedInitialRecordsWrite(alice.did, message);

      expect(reply.status.code).to.equal(401);
      expect(reply.status.detail).to.contain('not a tenant');
    });

    it('should run JSON schema validation', async () => {
      const invalidMessage = {
        descriptor: {
          interface : 'Records',
          method    : 'Write'
        },
        authorization: {}
      };

      const validateJsonSchemaSpy = sinon.spy(Message, 'validateJsonSchema');

      const alice = await DidKeyResolver.generate();
      const reply = await dwn.synchronizePrunedInitialRecordsWrite(alice.did, invalidMessage as RecordsWriteMessage);

      sinon.assert.calledOnce(validateJsonSchemaSpy);

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain(`must have required property 'recordId'`);
    });

    it('should throw 400 if given incorrect DWN interface or method', async () => {
      const alice = await DidKeyResolver.generate();
      const reply1 = await dwn.synchronizePrunedInitialRecordsWrite(alice.did, undefined as unknown as RecordsWriteMessage ); // missing message
      expect(reply1.status.code).to.equal(400);
      expect(reply1.status.detail).to.contain('Both interface and method must be present');

      const reply2 = await dwn.synchronizePrunedInitialRecordsWrite(
        alice.did,
        { descriptor: { interface: 'IncorrectInterface', method: DwnMethodName.Write } } as RecordsWriteMessage
      );
      expect(reply2.status.code).to.equal(400);
      expect(reply2.status.detail).to.contain(`Expected interface ${DwnInterfaceName.Records}`);

      const reply3 = await dwn.synchronizePrunedInitialRecordsWrite(
        alice.did,
        { descriptor: { interface: DwnInterfaceName.Records, method: 'IncorrectMethod' } } as RecordsWriteMessage
      );
      expect(reply3.status.code).to.equal(400);
      expect(reply3.status.detail).to.contain(`Expected method ${DwnInterfaceName.Records}${DwnMethodName.Write}`);
    });
  });
});
