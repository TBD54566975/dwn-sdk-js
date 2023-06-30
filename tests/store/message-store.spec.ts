import type { MessageStore } from '../../src/index.js';
import type { RecordsWriteMessage } from '../../src/types/records-types.js';

import { DidKeyResolver } from '../../src/index.js';
import { expect } from 'chai';
import { Message } from '../../src/core/message.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStoreInitializer } from '../test-store-initializer.js';

let messageStore: MessageStore;

describe('Generic MessageStore Test Suite', () => {
  describe('put', function () {

    // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
    // so that different test suites can reuse the same backend store for testing
    before(async () => {
      const stores = TestStoreInitializer.initializeStores();
      messageStore = stores.messageStore;
      await messageStore.open();
    });

    beforeEach(async () => {
      await messageStore.clear(); // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
    });

    after(async () => {
      await messageStore.close();
    });

    it('stores messages as cbor/sha256 encoded blocks with CID as key', async () => {
      const alice = await DidKeyResolver.generate();

      const { message } = await TestDataGenerator.generatePermissionsRequest();

      await messageStore.put(alice.did, message, {});

      const expectedCid = await Message.getCid(message);

      const jsonMessage = (await messageStore.get(alice.did, expectedCid))!;
      const resultCid = await Message.getCid(jsonMessage);

      expect(resultCid).to.equal(expectedCid);
    });

    // https://github.com/TBD54566975/dwn-sdk-js/issues/170
    it('#170 - should be able to update (delete and insert new) indexes to an existing message', async () => {
      const alice = await DidKeyResolver.generate();

      const { message } = await TestDataGenerator.generateRecordsWrite();

      // inserting the message indicating it is the 'latest' in the index
      await messageStore.put(alice.did, message, { latest: 'true' });

      const results1 = await messageStore.query(alice.did, { latest: 'true' });
      expect(results1.length).to.equal(1);

      const results2 = await messageStore.query(alice.did, { latest: 'false' });
      expect(results2.length).to.equal(0);

      // deleting the existing indexes and replacing it indicating it is no longer the 'latest'
      const cid = await Message.getCid(message);
      await messageStore.delete(alice.did, cid);
      await messageStore.put(alice.did, message, { latest: 'false' });

      const results3 = await messageStore.query(alice.did, { latest: 'true' });
      expect(results3.length).to.equal(0);

      const results4 = await messageStore.query(alice.did, { latest: 'false' });
      expect(results4.length).to.equal(1);
    });

    it('should index properties with characters beyond just letters and digits', async () => {
      const alice = await DidKeyResolver.generate();

      const schema = 'http://my-awesome-schema/awesomeness_schema';
      const { message } = await TestDataGenerator.generateRecordsWrite({ schema });

      await messageStore.put(alice.did, message, { schema });

      const results = await messageStore.query(alice.did, { schema });
      expect((results[0] as RecordsWriteMessage).descriptor.schema).to.equal(schema);
    });

    it('should not store anything if aborted beforehand', async () => {
      const alice = await DidKeyResolver.generate();

      const { message } = await TestDataGenerator.generateRecordsWrite();

      const controller = new AbortController();
      controller.signal.throwIfAborted = (): void => { }; // simulate aborting happening async
      controller.abort('reason');

      try {
        await messageStore.put(alice.did, message, {}, { signal: controller.signal });
      } catch (e) {
        expect(e).to.equal('reason');
      }

      const expectedCid = await Message.getCid(message);

      const jsonMessage = await messageStore.get(alice.did, expectedCid);
      expect(jsonMessage).to.equal(undefined);
    });

    it('should not index anything if aborted during', async () => {
      const alice = await DidKeyResolver.generate();

      const schema = 'http://my-awesome-schema/awesomeness_schema#awesome-1?id=awesome_1';
      const { message } = await TestDataGenerator.generateRecordsWrite({ schema });

      const controller = new AbortController();
      queueMicrotask(() => {
        controller.abort('reason');
      });

      try {
        await messageStore.put(alice.did, message, { schema }, { signal: controller.signal });
      } catch (e) {
        expect(e).to.equal('reason');
      }

      const results = await messageStore.query(alice.did, { schema });
      expect(results.length).to.equal(0);
    });
  });
});