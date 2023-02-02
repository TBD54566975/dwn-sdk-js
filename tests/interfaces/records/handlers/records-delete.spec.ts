import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DidKeyResolver } from '../../../../src/did/did-key-resolver.js';
import { handleRecordsDelete } from '../../../../src/interfaces/records/handlers/records-delete.js';
import { handleRecordsQuery } from '../../../../src/interfaces/records/handlers/records-query.js';
import { handleRecordsWrite } from '../../../../src/interfaces/records/handlers/records-write.js';
import { MessageStoreLevel } from '../../../../src/store/message-store-level.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import { TestStubGenerator } from '../../../utils/test-stub-generator.js';

export { RecordsDelete, RecordsDeleteOptions } from '../../../../src/interfaces/records/messages/records-delete.js';
import { DidResolver, RecordsDelete, RecordsWriteMessage } from '../../../../src/index.js';

chai.use(chaiAsPromised);

describe('handleRecordsDelete()', () => {
  let didResolver: DidResolver;

  describe('functional tests', () => {
    let messageStore: MessageStoreLevel;

    before(async () => {
      // important to follow this pattern to initialize the message store in tests
      // so that different suites can reuse the same block store and index location for testing
      messageStore = new MessageStoreLevel({
        blockstoreLocation : 'TEST-BLOCKSTORE',
        indexLocation      : 'TEST-INDEX'
      });

      await messageStore.open();

      didResolver = new DidResolver([new DidKeyResolver()]);
    });

    beforeEach(async () => {
      sinon.restore(); // wipe all previous stubs/spies/mocks/fakes
      await messageStore.clear(); // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
    });

    after(async () => {
      await messageStore.close();
    });

    it('should handle RecordsDelete successfully', async () => {
      // setting up a stub method resolver
      const alice = await DidKeyResolver.generate();

      // insert data
      const writeData = await TestDataGenerator.generateRecordsWrite({ requester: alice });
      const writeReply = await handleRecordsWrite(alice.did, writeData.message, messageStore, didResolver);
      expect(writeReply.status.code).to.equal(202);

      // ensure data is inserted
      const queryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { recordId: writeData.message.recordId }
      });
      const reply = await handleRecordsQuery(alice.did, queryData.message, messageStore, didResolver);
      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(1);

      // testing delete
      const recordsDelete = await RecordsDelete.create({
        recordId                    : writeData.message.recordId,
        authorizationSignatureInput : TestDataGenerator.createSignatureInputFromPersona(alice)
      });

      const deleteReply = await handleRecordsDelete(alice.did, recordsDelete.message, messageStore, didResolver);
      expect(deleteReply.status.code).to.equal(202);

      // ensure a query will no longer find the deleted record
      const reply2 = await handleRecordsQuery(alice.did, queryData.message, messageStore, didResolver);
      expect(reply2.status.code).to.equal(200);
      expect(reply2.entries?.length).to.equal(0);
    });

    it('should be disallowed if there is a newer RecordsWrite already in the DWN ', async () => {
      const alice = await DidKeyResolver.generate();

      // initial write
      const initialWriteData = await TestDataGenerator.generateRecordsWrite({ requester: alice });
      const initialWriteReply = await handleRecordsWrite(alice.did, initialWriteData.message, messageStore, didResolver);
      expect(initialWriteReply.status.code).to.equal(202);

      // generate subsequent write and delete with the delete having an earlier timestamp
      // NOTE: creating RecordsDelete first ensures it has an earlier `dateModified` time
      const recordsDelete = await RecordsDelete.create({
        recordId                    : initialWriteData.message.recordId,
        authorizationSignatureInput : TestDataGenerator.createSignatureInputFromPersona(alice)
      });
      const subsequentWriteData = await TestDataGenerator.generateFromRecordsWrite({
        existingWrite : initialWriteData.recordsWrite,
        requester     : alice
      });

      // subsequent write
      const subsequentWriteReply = await handleRecordsWrite(alice.did, subsequentWriteData.message, messageStore, didResolver);
      expect(subsequentWriteReply.status.code).to.equal(202);

      // test that a delete with an earlier `dateModified` results in a 409
      const deleteReply = await handleRecordsDelete(alice.did, recordsDelete.message, messageStore, didResolver);
      expect(deleteReply.status.code).to.equal(409);

      // ensure data still exists
      const queryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { recordId: initialWriteData.message.recordId }
      });
      const reply = await handleRecordsQuery(alice.did, queryData.message, messageStore, didResolver);
      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(1);
      expect((reply.entries[0] as RecordsWriteMessage).encodedData).to.equal(subsequentWriteData.message.encodedData);
    });
  });

  it('should return 401 if signature check fails', async () => {
    const { requester, message } = await TestDataGenerator.generateRecordsDelete();

    // setting up a stub did resolver & message store
    // intentionally not supplying the public key so a different public key is generated to simulate invalid signature
    const mismatchingPersona = await TestDataGenerator.generatePersona({ did: requester.did, keyId: requester.keyId });
    const didResolverStub = TestStubGenerator.createDidResolverStub(mismatchingPersona);
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

    const tenant = requester.did;
    const reply = await handleRecordsDelete(tenant, message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(401);
  });

  it('should return 400 if fail parsing the message', async () => {
    const { requester, message } = await TestDataGenerator.generateRecordsDelete();
    const tenant = requester.did;

    // setting up a stub method resolver & message store
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

    // stub the `parse()` function to throw an error
    sinon.stub(RecordsDelete, 'parse').throws('anyError');
    const reply = await handleRecordsDelete(tenant, message, messageStoreStub, didResolver);

    expect(reply.status.code).to.equal(400);
  });
});
