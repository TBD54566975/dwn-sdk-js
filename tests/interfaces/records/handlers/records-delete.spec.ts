import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { asyncGeneratorToArray } from '../../../../src/utils/array.js';
import { Cid } from '../../../../src/utils/cid.js';
import { DataStoreLevel } from '../../../../src/store/data-store-level.js';
import { DidKeyResolver } from '../../../../src/did/did-key-resolver.js';
import { DwnErrorCode } from '../../../../src/core/dwn-error.js';
import { EventLogLevel } from '../../../../src/event-log/event-log-level.js';
import { Message } from '../../../../src/core/message.js';
import { MessageStoreLevel } from '../../../../src/store/message-store-level.js';
import { RecordsDeleteHandler } from '../../../../src/interfaces/records/handlers/records-delete.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import { TestStubGenerator } from '../../../utils/test-stub-generator.js';
import { DidResolver, Dwn, Encoder, Jws, RecordsDelete, RecordsWrite } from '../../../../src/index.js';

chai.use(chaiAsPromised);

describe('RecordsDeleteHandler.handle()', () => {
  let didResolver: DidResolver;
  let messageStore: MessageStoreLevel;
  let dataStore: DataStoreLevel;
  let eventLog: EventLogLevel;
  let dwn: Dwn;

  describe('functional tests', () => {
    before(async () => {
      didResolver = new DidResolver([new DidKeyResolver()]);

      // important to follow this pattern to initialize and clean the message and data store in tests
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

    it('should handle RecordsDelete successfully', async () => {
      const alice = await DidKeyResolver.generate();

      // insert data
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice });
      const writeReply = await dwn.processMessage(alice.did, message, dataStream);
      expect(writeReply.status.code).to.equal(202);

      // ensure data is inserted
      const queryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { recordId: message.recordId }
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
    });

    it('should be disallowed if there is a newer RecordsWrite already in the DWN ', async () => {
      const alice = await DidKeyResolver.generate();

      // initial write
      const initialWriteData = await TestDataGenerator.generateRecordsWrite({ requester: alice });
      const initialWriteReply = await dwn.processMessage(alice.did, initialWriteData.message, initialWriteData.dataStream);
      expect(initialWriteReply.status.code).to.equal(202);

      // generate subsequent write and delete with the delete having an earlier timestamp
      // NOTE: creating RecordsDelete first ensures it has an earlier `dateModified` time
      const recordsDelete = await RecordsDelete.create({
        recordId                    : initialWriteData.message.recordId,
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      });
      const subsequentWriteData = await TestDataGenerator.generateFromRecordsWrite({
        existingWrite : initialWriteData.recordsWrite,
        requester     : alice
      });

      // subsequent write
      const subsequentWriteReply = await dwn.processMessage(alice.did, subsequentWriteData.message, subsequentWriteData.dataStream);
      expect(subsequentWriteReply.status.code).to.equal(202);

      // test that a delete with an earlier `dateModified` results in a 409
      const deleteReply = await dwn.processMessage(alice.did, recordsDelete.message);
      expect(deleteReply.status.code).to.equal(409);

      // ensure data still exists
      const queryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { recordId: initialWriteData.message.recordId }
      });
      const expectedEncodedData = Encoder.bytesToBase64Url(subsequentWriteData.dataBytes);
      const reply = await dwn.processMessage(alice.did, queryData.message);
      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(1);
      expect(reply.entries![0].encodedData).to.equal(expectedEncodedData);
    });

    it('should only write the data once even if written by multiple messages', async () => {
      const data = Encoder.stringToBytes('test');
      const dataCid = await Cid.computeDagPbCidFromBytes(data);
      const encodedData = Encoder.bytesToBase64Url(data);

      const blocksForData = await dataStore.blockstore.partition('data');
      const blocks = await blocksForData.partition(dataCid);

      const alice = await DidKeyResolver.generate();

      const aliceWrite1Data = await TestDataGenerator.generateRecordsWrite({
        requester: alice,
        data
      });
      const aliceWrite1Reply = await dwn.processMessage(alice.did, aliceWrite1Data.message, aliceWrite1Data.dataStream);
      expect(aliceWrite1Reply.status.code).to.equal(202);

      const aliceQueryWrite1AfterAliceWrite1Data = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { recordId: aliceWrite1Data.message.recordId }
      });
      const aliceQueryWrite1AfterAliceWrite1Reply = await dwn.processMessage(alice.did, aliceQueryWrite1AfterAliceWrite1Data.message);
      expect(aliceQueryWrite1AfterAliceWrite1Reply.status.code).to.equal(200);
      expect(aliceQueryWrite1AfterAliceWrite1Reply.entries?.length).to.equal(1);
      expect(aliceQueryWrite1AfterAliceWrite1Reply.entries![0].encodedData).to.equal(encodedData);

      await expect(asyncGeneratorToArray(blocks.db.keys())).to.eventually.eql([ dataCid ]);

      const aliceWrite2Data = await TestDataGenerator.generateRecordsWrite({
        requester: alice,
        data
      });
      const aliceWrite2Reply = await dwn.processMessage(alice.did, aliceWrite2Data.message, aliceWrite2Data.dataStream);
      expect(aliceWrite2Reply.status.code).to.equal(202);

      const aliceQueryWrite1AfterAliceWrite2Data = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { recordId: aliceWrite1Data.message.recordId }
      });
      const aliceQueryWrite1AfterAliceWrite2Reply = await dwn.processMessage(alice.did, aliceQueryWrite1AfterAliceWrite2Data.message);
      expect(aliceQueryWrite1AfterAliceWrite2Reply.status.code).to.equal(200);
      expect(aliceQueryWrite1AfterAliceWrite2Reply.entries?.length).to.equal(1);
      expect(aliceQueryWrite1AfterAliceWrite2Reply.entries![0].encodedData).to.equal(encodedData);

      const aliceQueryWrite2AfterAliceWrite2Data = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { recordId: aliceWrite2Data.message.recordId }
      });
      const aliceQueryWrite2AfterAliceWrite2Reply = await dwn.processMessage(alice.did, aliceQueryWrite2AfterAliceWrite2Data.message);
      expect(aliceQueryWrite2AfterAliceWrite2Reply.status.code).to.equal(200);
      expect(aliceQueryWrite2AfterAliceWrite2Reply.entries?.length).to.equal(1);
      expect(aliceQueryWrite2AfterAliceWrite2Reply.entries![0].encodedData).to.equal(encodedData);

      await expect(asyncGeneratorToArray(blocks.db.keys())).to.eventually.eql([ dataCid ]);
    });

    it('should only write the data once even if referenced by multiple messages', async () => {
      const data = Encoder.stringToBytes('test');
      const dataCid = await Cid.computeDagPbCidFromBytes(data);
      const encodedData = Encoder.bytesToBase64Url(data);

      const blocksForData = await dataStore.blockstore.partition('data');
      const blocks = await blocksForData.partition(dataCid);

      const alice = await DidKeyResolver.generate();

      const aliceWriteData = await TestDataGenerator.generateRecordsWrite({
        requester: alice,
        data
      });
      const aliceWriteReply = await dwn.processMessage(alice.did, aliceWriteData.message, aliceWriteData.dataStream);
      expect(aliceWriteReply.status.code).to.equal(202);

      const aliceQueryWriteAfterAliceWriteData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { recordId: aliceWriteData.message.recordId }
      });
      const aliceQueryWriteAfterAliceWriteReply = await dwn.processMessage(alice.did, aliceQueryWriteAfterAliceWriteData.message);
      expect(aliceQueryWriteAfterAliceWriteReply.status.code).to.equal(200);
      expect(aliceQueryWriteAfterAliceWriteReply.entries?.length).to.equal(1);
      expect(aliceQueryWriteAfterAliceWriteReply.entries![0].encodedData).to.equal(encodedData);

      await expect(asyncGeneratorToArray(blocks.db.keys())).to.eventually.eql([ dataCid ]);

      const aliceAssociateData = await TestDataGenerator.generateRecordsWrite({
        requester : alice,
        dataCid,
        dataSize  : 4
      });
      const aliceAssociateReply = await dwn.processMessage(alice.did, aliceAssociateData.message, aliceAssociateData.dataStream);
      expect(aliceAssociateReply.status.code).to.equal(202);

      const aliceQueryWriteAfterAliceAssociateData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { recordId: aliceWriteData.message.recordId }
      });
      const aliceQueryWriteAfterAliceAssociateReply = await dwn.processMessage(alice.did, aliceQueryWriteAfterAliceAssociateData.message);
      expect(aliceQueryWriteAfterAliceAssociateReply.status.code).to.equal(200);
      expect(aliceQueryWriteAfterAliceAssociateReply.entries?.length).to.equal(1);
      expect(aliceQueryWriteAfterAliceAssociateReply.entries![0].encodedData).to.equal(encodedData);

      const aliceQueryAssociateAfterAliceAssociateData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { recordId: aliceAssociateData.message.recordId }
      });
      const aliceQueryAssociateAfterAliceAssociateReply = await dwn.processMessage(alice.did, aliceQueryAssociateAfterAliceAssociateData.message);
      expect(aliceQueryAssociateAfterAliceAssociateReply.status.code).to.equal(200);
      expect(aliceQueryAssociateAfterAliceAssociateReply.entries?.length).to.equal(1);
      expect(aliceQueryAssociateAfterAliceAssociateReply.entries![0].encodedData).to.equal(encodedData);

      await expect(asyncGeneratorToArray(blocks.db.keys())).to.eventually.eql([ dataCid ]);
    });

    it('should only write the data once even if written by multiple tenants', async () => {
      const data = Encoder.stringToBytes('test');
      const dataCid = await Cid.computeDagPbCidFromBytes(data);
      const encodedData = Encoder.bytesToBase64Url(data);

      const blocksForData = await dataStore.blockstore.partition('data');
      const blocks = await blocksForData.partition(dataCid);

      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();

      const aliceWriteData = await TestDataGenerator.generateRecordsWrite({
        requester: alice,
        data
      });
      const aliceWriteReply = await dwn.processMessage(alice.did, aliceWriteData.message, aliceWriteData.dataStream);
      expect(aliceWriteReply.status.code).to.equal(202);

      const aliceQueryWriteAfterAliceWriteData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { recordId: aliceWriteData.message.recordId }
      });
      const aliceQueryWriteAfterAliceWriteReply = await dwn.processMessage(alice.did, aliceQueryWriteAfterAliceWriteData.message);
      expect(aliceQueryWriteAfterAliceWriteReply.status.code).to.equal(200);
      expect(aliceQueryWriteAfterAliceWriteReply.entries?.length).to.equal(1);
      expect(aliceQueryWriteAfterAliceWriteReply.entries![0].encodedData).to.equal(encodedData);

      await expect(asyncGeneratorToArray(blocks.db.keys())).to.eventually.eql([ dataCid ]);

      const bobWriteData = await TestDataGenerator.generateRecordsWrite({
        requester: bob,
        data
      });
      const bobWriteReply = await dwn.processMessage(bob.did, bobWriteData.message, bobWriteData.dataStream);
      expect(bobWriteReply.status.code).to.equal(202);

      const aliceQueryWriteAfterBobWriteData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { recordId: aliceWriteData.message.recordId }
      });
      const aliceQueryWriteAfterBobWriteReply = await dwn.processMessage(alice.did, aliceQueryWriteAfterBobWriteData.message);
      expect(aliceQueryWriteAfterBobWriteReply.status.code).to.equal(200);
      expect(aliceQueryWriteAfterBobWriteReply.entries?.length).to.equal(1);
      expect(aliceQueryWriteAfterBobWriteReply.entries![0].encodedData).to.equal(encodedData);

      const bobQueryWriteAfterBobWriteData = await TestDataGenerator.generateRecordsQuery({
        requester : bob,
        filter    : { recordId: bobWriteData.message.recordId }
      });
      const bobQueryWriteAfterBobWriteReply = await dwn.processMessage(bob.did, bobQueryWriteAfterBobWriteData.message);
      expect(bobQueryWriteAfterBobWriteReply.status.code).to.equal(200);
      expect(bobQueryWriteAfterBobWriteReply.entries?.length).to.equal(1);
      expect(bobQueryWriteAfterBobWriteReply.entries![0].encodedData).to.equal(encodedData);

      await expect(asyncGeneratorToArray(blocks.db.keys())).to.eventually.eql([ dataCid ]);
    });

    it('should not allow referencing data across tenants', async () => {
      const data = Encoder.stringToBytes('test');
      const dataCid = await Cid.computeDagPbCidFromBytes(data);
      const encodedData = Encoder.bytesToBase64Url(data);

      const blocksForData = await dataStore.blockstore.partition('data');
      const blocks = await blocksForData.partition(dataCid);

      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();

      const aliceWriteData = await TestDataGenerator.generateRecordsWrite({
        requester: alice,
        data
      });
      const aliceWriteReply = await dwn.processMessage(alice.did, aliceWriteData.message, aliceWriteData.dataStream);
      expect(aliceWriteReply.status.code).to.equal(202);

      const aliceQueryWriteAfterAliceWriteData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { recordId: aliceWriteData.message.recordId }
      });
      const aliceQueryWriteAfterAliceWriteReply = await dwn.processMessage(alice.did, aliceQueryWriteAfterAliceWriteData.message);
      expect(aliceQueryWriteAfterAliceWriteReply.status.code).to.equal(200);
      expect(aliceQueryWriteAfterAliceWriteReply.entries?.length).to.equal(1);
      expect(aliceQueryWriteAfterAliceWriteReply.entries![0].encodedData).to.equal(encodedData);

      await expect(asyncGeneratorToArray(blocks.db.keys())).to.eventually.eql([ dataCid ]);

      const bobAssociateData = await TestDataGenerator.generateRecordsWrite({
        requester : bob,
        dataCid,
        dataSize  : 4
      });
      const bobAssociateReply = await dwn.processMessage(bob.did, bobAssociateData.message, bobAssociateData.dataStream);
      expect(bobAssociateReply.status.code).to.equal(400);
      expect(bobAssociateReply.status.detail).to.contain(DwnErrorCode.MessageStoreDataNotFound);

      const aliceQueryWriteAfterBobAssociateData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { recordId: aliceWriteData.message.recordId }
      });
      const aliceQueryWriteAfterBobAssociateReply = await dwn.processMessage(alice.did, aliceQueryWriteAfterBobAssociateData.message);
      expect(aliceQueryWriteAfterBobAssociateReply.status.code).to.equal(200);
      expect(aliceQueryWriteAfterBobAssociateReply.entries?.length).to.equal(1);
      expect(aliceQueryWriteAfterBobAssociateReply.entries![0].encodedData).to.equal(encodedData);

      const bobQueryAssociateAfterBobAssociateData = await TestDataGenerator.generateRecordsQuery({
        requester : bob,
        filter    : { recordId: bobAssociateData.message.recordId }
      });
      const bobQueryAssociateAfterBobAssociateReply = await dwn.processMessage(bob.did, bobQueryAssociateAfterBobAssociateData.message);
      expect(bobQueryAssociateAfterBobAssociateReply.status.code).to.equal(200);
      expect(bobQueryAssociateAfterBobAssociateReply.entries?.length).to.equal(0);

      await expect(asyncGeneratorToArray(blocks.db.keys())).to.eventually.eql([ dataCid ]);
    });

    it('should be able to rewrite the data', async () => {
      const data = Encoder.stringToBytes('test');
      const dataCid = await Cid.computeDagPbCidFromBytes(data);
      const encodedData = Encoder.bytesToBase64Url(data);

      const blocksForData = await dataStore.blockstore.partition('data');
      const blocks = await blocksForData.partition(dataCid);

      const alice = await DidKeyResolver.generate();

      const aliceWriteData = await TestDataGenerator.generateRecordsWrite({
        requester: alice,
        data
      });
      const aliceWriteReply = await dwn.processMessage(alice.did, aliceWriteData.message, aliceWriteData.dataStream);
      expect(aliceWriteReply.status.code).to.equal(202);

      const aliceQueryWriteAfterAliceWriteData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { recordId: aliceWriteData.message.recordId }
      });
      const aliceQueryWriteAfterAliceWriteReply = await dwn.processMessage(alice.did, aliceQueryWriteAfterAliceWriteData.message);
      expect(aliceQueryWriteAfterAliceWriteReply.status.code).to.equal(200);
      expect(aliceQueryWriteAfterAliceWriteReply.entries?.length).to.equal(1);
      expect(aliceQueryWriteAfterAliceWriteReply.entries![0].encodedData).to.equal(encodedData);

      await expect(asyncGeneratorToArray(blocks.db.keys())).to.eventually.eql([ dataCid ]);

      const aliceDeleteWriteData = await TestDataGenerator.generateRecordsDelete({
        requester : alice,
        recordId  : aliceWriteData.message.recordId
      });
      const aliceDeleteWriteReply = await dwn.processMessage(alice.did, aliceDeleteWriteData.message);
      expect(aliceDeleteWriteReply.status.code).to.equal(202);

      const aliceQueryWriteAfterAliceDeleteData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { recordId: aliceWriteData.message.recordId }
      });
      const aliceQueryWriteAfterAliceDeleteReply = await dwn.processMessage(alice.did, aliceQueryWriteAfterAliceDeleteData.message);
      expect(aliceQueryWriteAfterAliceDeleteReply.status.code).to.equal(200);
      expect(aliceQueryWriteAfterAliceDeleteReply.entries?.length).to.equal(0);

      await expect(asyncGeneratorToArray(blocks.db.keys())).to.eventually.eql([ ]);

      const aliceRewriteData = await TestDataGenerator.generateRecordsWrite({
        requester: alice,
        data
      });
      const aliceRewriteReply = await dwn.processMessage(alice.did, aliceRewriteData.message, aliceRewriteData.dataStream);
      expect(aliceRewriteReply.status.code).to.equal(202);

      const aliceQueryWriteAfterAliceRewriteData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { recordId: aliceRewriteData.message.recordId }
      });
      const aliceQueryWriteAfterAliceRewriteReply = await dwn.processMessage(alice.did, aliceQueryWriteAfterAliceRewriteData.message);
      expect(aliceQueryWriteAfterAliceRewriteReply.status.code).to.equal(200);
      expect(aliceQueryWriteAfterAliceRewriteReply.entries?.length).to.equal(1);
      expect(aliceQueryWriteAfterAliceRewriteReply.entries![0].encodedData).to.equal(encodedData);

      await expect(asyncGeneratorToArray(blocks.db.keys())).to.eventually.eql([ dataCid ]);
    });

    it('should only delete data after all messages referencing it are deleted', async () => {
      const data = Encoder.stringToBytes('test');
      const dataCid = await Cid.computeDagPbCidFromBytes(data);

      const blocksForData = await dataStore.blockstore.partition('data');
      const blocks = await blocksForData.partition(dataCid);

      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();

      const aliceWriteData = await TestDataGenerator.generateRecordsWrite({
        requester: alice,
        data
      });
      const aliceWriteReply = await dwn.processMessage(alice.did, aliceWriteData.message, aliceWriteData.dataStream);
      expect(aliceWriteReply.status.code).to.equal(202);

      await expect(asyncGeneratorToArray(blocks.db.keys())).to.eventually.eql([ dataCid ]);

      const aliceAssociateData = await TestDataGenerator.generateRecordsWrite({
        requester : alice,
        dataCid,
        dataSize  : 4
      });
      const aliceAssociateReply = await dwn.processMessage(alice.did, aliceAssociateData.message, aliceAssociateData.dataStream);
      expect(aliceAssociateReply.status.code).to.equal(202);

      await expect(asyncGeneratorToArray(blocks.db.keys())).to.eventually.eql([ dataCid ]);

      const bobWriteData = await TestDataGenerator.generateRecordsWrite({
        requester: bob,
        data
      });
      const bobWriteReply = await dwn.processMessage(bob.did, bobWriteData.message, bobWriteData.dataStream);
      expect(bobWriteReply.status.code).to.equal(202);

      await expect(asyncGeneratorToArray(blocks.db.keys())).to.eventually.eql([ dataCid ]);

      const bobAssociateData = await TestDataGenerator.generateRecordsWrite({
        requester : bob,
        dataCid,
        dataSize  : 4
      });
      const bobAssociateReply = await dwn.processMessage(bob.did, bobAssociateData.message, bobAssociateData.dataStream);
      expect(bobAssociateReply.status.code).to.equal(202);

      await expect(asyncGeneratorToArray(blocks.db.keys())).to.eventually.eql([ dataCid ]);

      const aliceDeleteWriteData = await TestDataGenerator.generateRecordsDelete({
        requester : alice,
        recordId  : aliceWriteData.message.recordId
      });
      const aliceDeleteWriteReply = await dwn.processMessage(alice.did, aliceDeleteWriteData.message);
      expect(aliceDeleteWriteReply.status.code).to.equal(202);

      await expect(asyncGeneratorToArray(blocks.db.keys())).to.eventually.eql([ dataCid ]);

      const bobDeleteWriteData = await TestDataGenerator.generateRecordsDelete({
        requester : bob,
        recordId  : bobWriteData.message.recordId
      });
      const bobDeleteWriteReply = await dwn.processMessage(bob.did, bobDeleteWriteData.message);
      expect(bobDeleteWriteReply.status.code).to.equal(202);

      await expect(asyncGeneratorToArray(blocks.db.keys())).to.eventually.eql([ dataCid ]);

      const aliceDeleteAssociateData = await TestDataGenerator.generateRecordsDelete({
        requester : alice,
        recordId  : aliceAssociateData.message.recordId
      });
      const aliceDeleteAssociateReply = await dwn.processMessage(alice.did, aliceDeleteAssociateData.message);
      expect(aliceDeleteAssociateReply.status.code).to.equal(202);

      await expect(asyncGeneratorToArray(blocks.db.keys())).to.eventually.eql([ dataCid ]);

      const bobDeleteAssociateData = await TestDataGenerator.generateRecordsDelete({
        requester : bob,
        recordId  : bobAssociateData.message.recordId
      });
      const bobDeleteAssociateReply = await dwn.processMessage(bob.did, bobDeleteAssociateData.message);
      expect(bobDeleteAssociateReply.status.code).to.equal(202);

      await expect(asyncGeneratorToArray(blocks.db.keys())).to.eventually.eql([ ]);
    });

    describe('event log', () => {
      it('should include RecordsDelete event and keep initial RecordsWrite event', async () => {
        const alice = await DidKeyResolver.generate();

        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice });
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
        const { message, requester, dataStream, recordsWrite } = await TestDataGenerator.generateRecordsWrite();
        TestStubGenerator.stubDidResolver(didResolver, [requester]);

        const reply = await dwn.processMessage(requester.did, message, dataStream);
        expect(reply.status.code).to.equal(202);

        const newWrite = await RecordsWrite.createFrom({
          unsignedRecordsWriteMessage : recordsWrite.message,
          published                   : true,
          authorizationSignatureInput : Jws.createSignatureInput(requester)
        });

        const newWriteReply = await dwn.processMessage(requester.did, newWrite.message);
        expect(newWriteReply.status.code).to.equal(202);

        const recordsDelete = await RecordsDelete.create({
          recordId                    : message.recordId,
          authorizationSignatureInput : Jws.createSignatureInput(requester)
        });

        const deleteReply = await dwn.processMessage(requester.did, recordsDelete.message);
        expect(deleteReply.status.code).to.equal(202);

        const events = await eventLog.getEvents(requester.did);
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
    const { requester, message } = await TestDataGenerator.generateRecordsDelete();
    const tenant = requester.did;

    // setting up a stub did resolver & message store
    // intentionally not supplying the public key so a different public key is generated to simulate invalid signature
    const mismatchingPersona = await TestDataGenerator.generatePersona({ did: requester.did, keyId: requester.keyId });
    const didResolver = TestStubGenerator.createDidResolverStub(mismatchingPersona);
    const messageStore = sinon.createStubInstance(MessageStoreLevel);
    const dataStore = sinon.createStubInstance(DataStoreLevel);

    const recordsDeleteHandler = new RecordsDeleteHandler(didResolver, messageStore, dataStore, eventLog);
    const reply = await recordsDeleteHandler.handle({ tenant, message });
    expect(reply.status.code).to.equal(401);
  });

  it('should return 400 if fail parsing the message', async () => {
    const { requester, message } = await TestDataGenerator.generateRecordsDelete();
    const tenant = requester.did;

    // setting up a stub method resolver & message store
    const messageStore = sinon.createStubInstance(MessageStoreLevel);
    const dataStore = sinon.createStubInstance(DataStoreLevel);

    const recordsDeleteHandler = new RecordsDeleteHandler(didResolver, messageStore, dataStore, eventLog);

    // stub the `parse()` function to throw an error
    sinon.stub(RecordsDelete, 'parse').throws('anyError');
    const reply = await recordsDeleteHandler.handle({ tenant, message });

    expect(reply.status.code).to.equal(400);
  });
});
