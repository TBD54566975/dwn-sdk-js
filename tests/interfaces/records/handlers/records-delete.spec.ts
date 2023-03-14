import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DataStoreLevel } from '../../../../src/store/data-store-level.js';
import { DidKeyResolver } from '../../../../src/did/did-key-resolver.js';
import { MessageStoreLevel } from '../../../../src/store/message-store-level.js';
import { RecordsDeleteHandler } from '../../../../src/interfaces/records/handlers/records-delete.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import { TestStubGenerator } from '../../../utils/test-stub-generator.js';

import { DidResolver, Dwn, Encoder, Jws, RecordsDelete } from '../../../../src/index.js';

chai.use(chaiAsPromised);

describe('RecordsDeleteHandler.handle()', () => {
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
      expect(reply.entries[0].encodedData).to.equal(expectedEncodedData);
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

    const recordsDeleteHandler = new RecordsDeleteHandler(didResolver, messageStore, dataStore);
    const reply = await recordsDeleteHandler.handle({ tenant, message });
    expect(reply.status.code).to.equal(401);
  });

  it('should return 400 if fail parsing the message', async () => {
    const { requester, message } = await TestDataGenerator.generateRecordsDelete();
    const tenant = requester.did;

    // setting up a stub method resolver & message store
    const messageStore = sinon.createStubInstance(MessageStoreLevel);
    const dataStore = sinon.createStubInstance(DataStoreLevel);

    const recordsDeleteHandler = new RecordsDeleteHandler(didResolver, messageStore, dataStore);

    // stub the `parse()` function to throw an error
    sinon.stub(RecordsDelete, 'parse').throws('anyError');
    const reply = await recordsDeleteHandler.handle({ tenant, message });

    expect(reply.status.code).to.equal(400);
  });
});
