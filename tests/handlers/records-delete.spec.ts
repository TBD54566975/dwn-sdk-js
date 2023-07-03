import type {
  DataStore,
  EventLog,
  MessageStore
} from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { ArrayUtility } from '../../src/utils/array.js';
import { DidKeyResolver } from '../../src/did/did-key-resolver.js';
import { Message } from '../../src/core/message.js';
import { RecordsDeleteHandler } from '../../src/handlers/records-delete.js';
import { stubInterface } from 'ts-sinon';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStoreInitializer } from '../test-store-initializer.js';
import { TestStubGenerator } from '../utils/test-stub-generator.js';
import { DataStream, DidResolver, Dwn, Encoder, Jws, RecordsDelete, RecordsRead, RecordsWrite } from '../../src/index.js';

chai.use(chaiAsPromised);

describe('RecordsDeleteHandler.handle()', () => {
  let didResolver: DidResolver;
  let messageStore: MessageStore;
  let dataStore: DataStore;
  let eventLog: EventLog;
  let dwn: Dwn;

  describe('functional tests', () => {

    // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
    // so that different test suites can reuse the same backend store for testing
    before(async () => {
      didResolver = new DidResolver([new DidKeyResolver()]);

      const stores = TestStoreInitializer.initializeStores();
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

    it('should handle RecordsDelete successfully and return 404 if deleting a deleted record', async () => {
      const alice = await DidKeyResolver.generate();

      // insert data
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice });
      const writeReply = await dwn.processMessage(alice.did, message, dataStream);
      expect(writeReply.status.code).to.equal(202);

      // ensure data is inserted
      const queryData = await TestDataGenerator.generateRecordsQuery({
        author : alice,
        filter : { recordId: message.recordId }
      });

      const reply = await dwn.processMessage(alice.did, queryData.message);
      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(1);

      // testing delete
      const recordsDelete = await RecordsDelete.create({
        recordId                    : message.recordId,
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      });

      const deleteReply = await dwn.processMessage(alice.did, recordsDelete.message);
      expect(deleteReply.status.code).to.equal(202);

      // ensure a query will no longer find the deleted record
      const reply2 = await dwn.processMessage(alice.did, queryData.message);
      expect(reply2.status.code).to.equal(200);
      expect(reply2.entries?.length).to.equal(0);

      // testing deleting a deleted record
      const recordsDelete2 = await RecordsDelete.create({
        recordId                    : message.recordId,
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      });

      const recordsDelete2Reply = await dwn.processMessage(alice.did, recordsDelete2.message);
      expect(recordsDelete2Reply.status.code).to.equal(404);
    });

    it('should not affect other records or tenants with the same data', async () => {
      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();
      const data = Encoder.stringToBytes('test');

      // alice writes a records with data
      const aliceWriteData = await TestDataGenerator.generateRecordsWrite({ author: alice, data });
      const aliceWriteReply = await dwn.processMessage(alice.did, aliceWriteData.message, aliceWriteData.dataStream);
      expect(aliceWriteReply.status.code).to.equal(202);

      // alice writes another record with the same data
      const aliceAssociateData = await TestDataGenerator.generateRecordsWrite({ author: alice, data });
      const aliceAssociateReply = await dwn.processMessage(alice.did, aliceAssociateData.message, aliceAssociateData.dataStream);
      expect(aliceAssociateReply.status.code).to.equal(202);

      // bob writes a records with same data
      const bobWriteData = await TestDataGenerator.generateRecordsWrite({ author: bob, data });
      const bobWriteReply = await dwn.processMessage(bob.did, bobWriteData.message, bobWriteData.dataStream);
      expect(bobWriteReply.status.code).to.equal(202);

      // bob writes another record with the same data
      const bobAssociateData = await TestDataGenerator.generateRecordsWrite({ author: bob, data });
      const bobAssociateReply = await dwn.processMessage(bob.did, bobAssociateData.message, bobAssociateData.dataStream);
      expect(bobAssociateReply.status.code).to.equal(202);

      // alice deletes one of the two records
      const aliceDeleteWriteData = await TestDataGenerator.generateRecordsDelete({
        author   : alice,
        recordId : aliceWriteData.message.recordId
      });
      const aliceDeleteWriteReply = await dwn.processMessage(alice.did, aliceDeleteWriteData.message);
      expect(aliceDeleteWriteReply.status.code).to.equal(202);

      // verify the other record with the same data is unaffected
      const aliceRead1 = await RecordsRead.create({
        recordId                    : aliceAssociateData.message.recordId,
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      });

      const aliceRead1Reply = await dwn.handleRecordsRead(alice.did, aliceRead1.message);
      expect(aliceRead1Reply.status.code).to.equal(200);

      const aliceDataFetched = await DataStream.toBytes(aliceRead1Reply.record!.data!);
      expect(ArrayUtility.byteArraysEqual(aliceDataFetched, data)).to.be.true;

      // alice deletes the other record
      const aliceDeleteAssociateData = await TestDataGenerator.generateRecordsDelete({
        author   : alice,
        recordId : aliceAssociateData.message.recordId
      });
      const aliceDeleteAssociateReply = await dwn.processMessage(alice.did, aliceDeleteAssociateData.message);
      expect(aliceDeleteAssociateReply.status.code).to.equal(202);

      // verify that alice can no longer fetch the 2nd record
      const aliceRead2Reply = await dwn.handleRecordsRead(alice.did, aliceRead1.message);
      expect(aliceRead2Reply.status.code).to.equal(404);

      // verify that bob can still fetch record with the same data
      const bobRead1 = await RecordsRead.create({
        recordId                    : bobAssociateData.message.recordId,
        authorizationSignatureInput : Jws.createSignatureInput(bob)
      });

      const bobRead1Reply = await dwn.handleRecordsRead(bob.did, bobRead1.message);
      expect(bobRead1Reply.status.code).to.equal(200);

      const bobDataFetched = await DataStream.toBytes(bobRead1Reply.record!.data!);
      expect(ArrayUtility.byteArraysEqual(bobDataFetched, data)).to.be.true;
    });

    it('should return 404 if deleting a non-existent record', async () => {
      const alice = await DidKeyResolver.generate();

      // testing deleting a non-existent record
      const recordsDelete = await RecordsDelete.create({
        recordId                    : 'nonExistentRecordId',
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      });

      const deleteReply = await dwn.processMessage(alice.did, recordsDelete.message);
      expect(deleteReply.status.code).to.equal(404);
    });

    it('should be disallowed if there is a newer RecordsWrite already in the DWN ', async () => {
      const alice = await DidKeyResolver.generate();

      // initial write
      const initialWriteData = await TestDataGenerator.generateRecordsWrite({ author: alice });
      const initialWriteReply = await dwn.processMessage(alice.did, initialWriteData.message, initialWriteData.dataStream);
      expect(initialWriteReply.status.code).to.equal(202);

      // generate subsequent write and delete with the delete having an earlier timestamp
      // NOTE: creating RecordsDelete first ensures it has an earlier `messageTimestamp` time
      const recordsDelete = await RecordsDelete.create({
        recordId                    : initialWriteData.message.recordId,
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      });
      const subsequentWriteData = await TestDataGenerator.generateFromRecordsWrite({
        existingWrite : initialWriteData.recordsWrite,
        author        : alice
      });

      // subsequent write
      const subsequentWriteReply = await dwn.processMessage(alice.did, subsequentWriteData.message, subsequentWriteData.dataStream);
      expect(subsequentWriteReply.status.code).to.equal(202);

      // test that a delete with an earlier `messageTimestamp` results in a 409
      const deleteReply = await dwn.processMessage(alice.did, recordsDelete.message);
      expect(deleteReply.status.code).to.equal(409);

      // ensure data still exists
      const queryData = await TestDataGenerator.generateRecordsQuery({
        author : alice,
        filter : { recordId: initialWriteData.message.recordId }
      });
      const expectedEncodedData = Encoder.bytesToBase64Url(subsequentWriteData.dataBytes);
      const reply = await dwn.processMessage(alice.did, queryData.message);
      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(1);
      expect(reply.entries![0].encodedData).to.equal(expectedEncodedData);
    });

    it('should be able to delete then rewrite the same data', async () => {
      const alice = await DidKeyResolver.generate();
      const data = Encoder.stringToBytes('test');
      const encodedData = Encoder.bytesToBase64Url(data);

      // alice writes a record
      const aliceWriteData = await TestDataGenerator.generateRecordsWrite({
        author: alice,
        data
      });
      const aliceWriteReply = await dwn.processMessage(alice.did, aliceWriteData.message, aliceWriteData.dataStream);
      expect(aliceWriteReply.status.code).to.equal(202);

      const aliceQueryWriteAfterAliceWriteData = await TestDataGenerator.generateRecordsQuery({
        author : alice,
        filter : { recordId: aliceWriteData.message.recordId }
      });
      const aliceQueryWriteAfterAliceWriteReply = await dwn.processMessage(alice.did, aliceQueryWriteAfterAliceWriteData.message);
      expect(aliceQueryWriteAfterAliceWriteReply.status.code).to.equal(200);
      expect(aliceQueryWriteAfterAliceWriteReply.entries?.length).to.equal(1);
      expect(aliceQueryWriteAfterAliceWriteReply.entries![0].encodedData).to.equal(encodedData);

      // alice deleting the record
      const aliceDeleteWriteData = await TestDataGenerator.generateRecordsDelete({
        author   : alice,
        recordId : aliceWriteData.message.recordId
      });
      const aliceDeleteWriteReply = await dwn.processMessage(alice.did, aliceDeleteWriteData.message);
      expect(aliceDeleteWriteReply.status.code).to.equal(202);

      const aliceQueryWriteAfterAliceDeleteData = await TestDataGenerator.generateRecordsQuery({
        author : alice,
        filter : { recordId: aliceWriteData.message.recordId }
      });
      const aliceQueryWriteAfterAliceDeleteReply = await dwn.processMessage(alice.did, aliceQueryWriteAfterAliceDeleteData.message);
      expect(aliceQueryWriteAfterAliceDeleteReply.status.code).to.equal(200);
      expect(aliceQueryWriteAfterAliceDeleteReply.entries?.length).to.equal(0);

      // alice writes a new record with the same data
      const aliceRewriteData = await TestDataGenerator.generateRecordsWrite({
        author: alice,
        data
      });
      const aliceRewriteReply = await dwn.processMessage(alice.did, aliceRewriteData.message, aliceRewriteData.dataStream);
      expect(aliceRewriteReply.status.code).to.equal(202);

      const aliceQueryWriteAfterAliceRewriteData = await TestDataGenerator.generateRecordsQuery({
        author : alice,
        filter : { recordId: aliceRewriteData.message.recordId }
      });
      const aliceQueryWriteAfterAliceRewriteReply = await dwn.processMessage(alice.did, aliceQueryWriteAfterAliceRewriteData.message);
      expect(aliceQueryWriteAfterAliceRewriteReply.status.code).to.equal(200);
      expect(aliceQueryWriteAfterAliceRewriteReply.entries?.length).to.equal(1);
      expect(aliceQueryWriteAfterAliceRewriteReply.entries![0].encodedData).to.equal(encodedData);
    });

    describe('event log', () => {
      it('should include RecordsDelete event and keep initial RecordsWrite event', async () => {
        const alice = await DidKeyResolver.generate();

        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const writeReply = await dwn.processMessage(alice.did, message, dataStream);
        expect(writeReply.status.code).to.equal(202);

        const recordsDelete = await RecordsDelete.create({
          recordId                    : message.recordId,
          authorizationSignatureInput : Jws.createSignatureInput(alice)
        });

        const deleteReply = await dwn.processMessage(alice.did, recordsDelete.message);
        expect(deleteReply.status.code).to.equal(202);

        const events = await eventLog.getEvents(alice.did);
        expect(events.length).to.equal(2);

        const writeMessageCid = await Message.getCid(message);
        const deleteMessageCid = await Message.getCid(recordsDelete.message);
        const expectedMessageCids = new Set([writeMessageCid, deleteMessageCid]);

        for (const { messageCid } of events) {
          expectedMessageCids.delete(messageCid);
        }

        expect(expectedMessageCids.size).to.equal(0);
      });

      it('should only keep first write and delete when subsequent writes happen', async () => {
        const { message, author, dataStream, recordsWrite } = await TestDataGenerator.generateRecordsWrite();
        TestStubGenerator.stubDidResolver(didResolver, [author]);

        const reply = await dwn.processMessage(author.did, message, dataStream);
        expect(reply.status.code).to.equal(202);

        const newWrite = await RecordsWrite.createFrom({
          unsignedRecordsWriteMessage : recordsWrite.message,
          published                   : true,
          authorizationSignatureInput : Jws.createSignatureInput(author)
        });

        const newWriteReply = await dwn.processMessage(author.did, newWrite.message);
        expect(newWriteReply.status.code).to.equal(202);

        const recordsDelete = await RecordsDelete.create({
          recordId                    : message.recordId,
          authorizationSignatureInput : Jws.createSignatureInput(author)
        });

        const deleteReply = await dwn.processMessage(author.did, recordsDelete.message);
        expect(deleteReply.status.code).to.equal(202);

        const events = await eventLog.getEvents(author.did);
        expect(events.length).to.equal(2);

        const deletedMessageCid = await Message.getCid(newWrite.message);

        for (const { messageCid } of events) {
          if (messageCid === deletedMessageCid ) {
            expect.fail(`${messageCid} should not exist`);
          }
        }
      });
    });
  });

  it('should return 401 if signature check fails', async () => {
    const { author, message } = await TestDataGenerator.generateRecordsDelete();
    const tenant = author.did;

    // setting up a stub did resolver & message store
    // intentionally not supplying the public key so a different public key is generated to simulate invalid signature
    const mismatchingPersona = await TestDataGenerator.generatePersona({ did: author.did, keyId: author.keyId });
    const didResolver = TestStubGenerator.createDidResolverStub(mismatchingPersona);
    const messageStore = stubInterface<MessageStore>();
    const dataStore = stubInterface<DataStore>();

    const recordsDeleteHandler = new RecordsDeleteHandler(didResolver, messageStore, dataStore, eventLog);
    const reply = await recordsDeleteHandler.handle({ tenant, message });
    expect(reply.status.code).to.equal(401);
  });

  it('should return 400 if fail parsing the message', async () => {
    const { author, message } = await TestDataGenerator.generateRecordsDelete();
    const tenant = author.did;

    // setting up a stub method resolver & message store
    const messageStore = stubInterface<MessageStore>();
    const dataStore = stubInterface<DataStore>();

    const recordsDeleteHandler = new RecordsDeleteHandler(didResolver, messageStore, dataStore, eventLog);

    // stub the `parse()` function to throw an error
    sinon.stub(RecordsDelete, 'parse').throws('anyError');
    const reply = await recordsDeleteHandler.handle({ tenant, message });

    expect(reply.status.code).to.equal(400);
  });
});
