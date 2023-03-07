import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { Comparer } from '../../../utils/comparer.js';
import { DataStoreLevel } from '../../../../src/store/data-store-level.js';
import { DidKeyResolver } from '../../../../src/did/did-key-resolver.js';
import { MessageStoreLevel } from '../../../../src/store/message-store-level.js';
import { RecordsReadHandler } from '../../../../src/interfaces/records/handlers/records-read.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import { TestStubGenerator } from '../../../utils/test-stub-generator.js';

import { DataStream, DidResolver, Dwn, Jws, RecordsDelete, RecordsRead } from '../../../../src/index.js';

chai.use(chaiAsPromised);

describe('RecordsReadHandler.handle()', () => {
  let didResolver: DidResolver;
  let messageStore: MessageStoreLevel;
  let dataStore: DataStoreLevel;
  let dwn: Dwn;

  describe('functional tests', () => {
    before(async () => {
      didResolver = new DidResolver([new DidKeyResolver()]);

      // important to follow this pattern to initialize and clean the message and data store in tests
      // so that different suites can reuse the same block store and index location for testing
      messageStore = new MessageStoreLevel({
        blockstoreLocation : 'TEST-BLOCKSTORE',
        indexLocation      : 'TEST-INDEX'
      });

      dataStore = new DataStoreLevel({
        blockstoreLocation: 'TEST-DATASTORE'
      });

      dwn = await Dwn.create({ didResolver, messageStore, dataStore });
    });

    beforeEach(async () => {
      sinon.restore(); // wipe all previous stubs/spies/mocks/fakes

      // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
      await messageStore.clear();
      await dataStore.clear();
    });

    after(async () => {
      await dwn.close();
    });

    it('should allow tenant to RecordsRead their own record', async () => {
      const alice = await DidKeyResolver.generate();

      // insert data
      const { message, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({ requester: alice });
      const writeReply = await dwn.processMessage(alice.did, message, dataStream);
      expect(writeReply.status.code).to.equal(202);

      // testing RecordsRead
      const recordsRead = await RecordsRead.create({
        recordId                    : message.recordId,
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      });

      const readReply = await dwn.processMessage(alice.did, recordsRead.message);
      expect(readReply.status.code).to.equal(200);

      const dataFetched = await DataStream.toBytes(readReply.data);
      expect(Comparer.byteArraysEqual(dataFetched, dataBytes)).to.be.true;
    });

    it('should not allow non-tenant to RecordsRead their a record data', async () => {
      const alice = await DidKeyResolver.generate();

      // insert data
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice });
      const writeReply = await dwn.processMessage(alice.did, message, dataStream);
      expect(writeReply.status.code).to.equal(202);

      // testing RecordsRead
      const bob = await DidKeyResolver.generate();

      const recordsRead = await RecordsRead.create({
        recordId                    : message.recordId,
        authorizationSignatureInput : Jws.createSignatureInput(bob)
      });

      const readReply = await dwn.processMessage(alice.did, recordsRead.message);
      expect(readReply.status.code).to.equal(401);
    });

    it('should allow reading of data that is published without `authorization`', async () => {
      const alice = await DidKeyResolver.generate();

      // insert public data
      const { message, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({ requester: alice, published: true });
      const writeReply = await dwn.processMessage(alice.did, message, dataStream);
      expect(writeReply.status.code).to.equal(202);

      // testing public RecordsRead
      const recordsRead = await RecordsRead.create({
        recordId: message.recordId
      });

      const readReply = await dwn.processMessage(alice.did, recordsRead.message);
      expect(readReply.status.code).to.equal(200);

      const dataFetched = await DataStream.toBytes(readReply.data);
      expect(Comparer.byteArraysEqual(dataFetched, dataBytes)).to.be.true;
    });

    it('should allow an authenticated user to RecordRead data that is published', async () => {
      const alice = await DidKeyResolver.generate();

      // insert public data
      const { message, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({ requester: alice, published: true });
      const writeReply = await dwn.processMessage(alice.did, message, dataStream);
      expect(writeReply.status.code).to.equal(202);

      // testing public RecordsRead
      const bob = await DidKeyResolver.generate();

      const recordsRead = await RecordsRead.create({
        recordId                    : message.recordId,
        authorizationSignatureInput : Jws.createSignatureInput(bob)
      });

      const readReply = await dwn.processMessage(alice.did, recordsRead.message);
      expect(readReply.status.code).to.equal(200);

      const dataFetched = await DataStream.toBytes(readReply.data);
      expect(Comparer.byteArraysEqual(dataFetched, dataBytes)).to.be.true;
    });

    it('should return 404 RecordRead if data does not exist', async () => {
      const alice = await DidKeyResolver.generate();

      const recordsRead = await RecordsRead.create({
        recordId                    : `non-existent-record-id`,
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      });

      const readReply = await dwn.processMessage(alice.did, recordsRead.message);
      expect(readReply.status.code).to.equal(404);
    });

    it('should return 404 RecordRead if data has been deleted', async () => {
      const alice = await DidKeyResolver.generate();

      // insert public data
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice, published: true });
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

      // RecordsDelete
      const recordsDelete = await RecordsDelete.create({
        recordId                    : message.recordId,
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      });

      const deleteReply = await dwn.processMessage(alice.did, recordsDelete.message);
      expect(deleteReply.status.code).to.equal(202);

      // RecordsRead
      const recordsRead = await RecordsRead.create({
        recordId                    : message.recordId,
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      });

      const readReply = await dwn.processMessage(alice.did, recordsRead.message);
      expect(readReply.status.code).to.equal(404);
    });

    it('should return 404 underlying data store cannot locate the data', async () => {
      const alice = await DidKeyResolver.generate();

      sinon.stub(dataStore, 'get').resolves(undefined);

      // insert data
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice });
      const writeReply = await dwn.processMessage(alice.did, message, dataStream);
      expect(writeReply.status.code).to.equal(202);

      // testing RecordsRead
      const recordsRead = await RecordsRead.create({
        recordId                    : message.recordId,
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      });

      const readReply = await dwn.processMessage(alice.did, recordsRead.message);
      expect(readReply.status.code).to.equal(404);
    });
  });

  it('should return 401 if signature check fails', async () => {
    const alice = await DidKeyResolver.generate();
    const recordsRead = await RecordsRead.create({
      recordId                    : 'any-id',
      authorizationSignatureInput : Jws.createSignatureInput(alice)
    });

    // setting up a stub did resolver & message store
    // intentionally not supplying the public key so a different public key is generated to simulate invalid signature
    const mismatchingPersona = await TestDataGenerator.generatePersona({ did: alice.did, keyId: alice.keyId });
    const didResolver = TestStubGenerator.createDidResolverStub(mismatchingPersona);
    const messageStore = sinon.createStubInstance(MessageStoreLevel);
    const dataStore = sinon.createStubInstance(DataStoreLevel);

    const recordsReadHandler = new RecordsReadHandler(didResolver, messageStore, dataStore);
    const reply = await recordsReadHandler.handle({ tenant: alice, message: recordsRead.message });
    expect(reply.status.code).to.equal(401);
  });

  it('should return 400 if fail parsing the message', async () => {
    const alice = await DidKeyResolver.generate();
    const recordsRead = await RecordsRead.create({
      recordId                    : 'any-id',
      authorizationSignatureInput : Jws.createSignatureInput(alice)
    });

    // setting up a stub method resolver & message store
    const messageStore = sinon.createStubInstance(MessageStoreLevel);
    const dataStore = sinon.createStubInstance(DataStoreLevel);

    const recordsReadHandler = new RecordsReadHandler(didResolver, messageStore, dataStore);

    // stub the `parse()` function to throw an error
    sinon.stub(RecordsRead, 'parse').throws('anyError');
    const reply = await recordsReadHandler.handle({ tenant: alice, message: recordsRead.message });

    expect(reply.status.code).to.equal(400);
  });
});
