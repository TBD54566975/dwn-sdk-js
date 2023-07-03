import type { MessageStore } from '../../src/index.js';
import type { CreateLevelDatabaseOptions, LevelDatabase } from '../../src/store/level-wrapper.js';

import { createLevelDatabase } from '../../src/store/level-wrapper.js';
import { expect } from 'chai';
import { MessageStoreLevel } from '../../src/store/message-store-level.js';
import { TestStoreInitializer } from '../test-store-initializer.js';

let messageStore: MessageStore;

describe('MessageStoreLevel Test Suite', () => {
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

  describe('createLevelDatabase', function () {
    it('should be called if provided', async () => {
      // need to close the message store instance first before creating a new one with the same name below
      await messageStore.close();

      const locations = new Set;

      messageStore = new MessageStoreLevel({
        blockstoreLocation : 'TEST-MESSAGESTORE',
        indexLocation      : 'TEST-INDEX',
        createLevelDatabase<V>(location: string, options?: CreateLevelDatabaseOptions<V>): Promise<LevelDatabase<V>> {
          locations.add(location);
          return createLevelDatabase(location, options);
        }
      });
      await messageStore.open();

      expect(locations).to.eql(new Set([ 'TEST-MESSAGESTORE', 'TEST-INDEX' ]));
    });
  });
});