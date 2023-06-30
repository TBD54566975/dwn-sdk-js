import type { DataStore, EventLog, MessageStore } from '../src/index.js';
import { DataStoreLevel, EventLogLevel, MessageStoreLevel } from '../src/index.js';

/**
 * Class that initializes store implementations for testing.
 * This is intended to be extended as the single point of configuration
 * that allows different store implementations to be swapped in
 * to test compatibility with default/built-in store implementations.
 */
export class TestStoreInitializer {

  /**
   * Initializes and return the stores used for running the test suite.
   */
  public static initializeStores(): { messageStore: MessageStore, dataStore: DataStore, eventLog: EventLog } {
    const messageStore = new MessageStoreLevel({
      blockstoreLocation : 'TEST-MESSAGESTORE',
      indexLocation      : 'TEST-INDEX'
    });

    const dataStore = new DataStoreLevel({
      blockstoreLocation: 'TEST-DATASTORE'
    });

    const eventLog = new EventLogLevel({
      location: 'TEST-EVENTLOG'
    });

    return { messageStore, dataStore, eventLog };
  }
}