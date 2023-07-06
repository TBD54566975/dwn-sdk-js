import type { DataStore, EventLog, MessageStore } from '../src/index.js';
import { DataStoreLevel, EventLogLevel, MessageStoreLevel } from '../src/index.js';

/**
 * Class that initializes store implementations for testing.
 * This is intended to be extended as the single point of configuration
 * that allows different store implementations to be swapped in
 * to test compatibility with default/built-in store implementations.
 */
export class TestStoreInitializer {

  private static messageStore?: MessageStore;
  private static dataStore?: DataStore;
  private static eventLog?: EventLog;

  /**
   * Overrides test stores with given implementation.
   * If not given, default implementation will be used.
   */
  public static overrideStores(input?: { messageStore?: MessageStore, dataStore?: DataStore, eventLog?: EventLog }): void {
    TestStoreInitializer.messageStore = input?.messageStore;
    TestStoreInitializer.dataStore = input?.dataStore;
    TestStoreInitializer.eventLog = input?.eventLog;
  }

  /**
   * Initializes and return the stores used for running the test suite.
   */
  public static initializeStores(): { messageStore: MessageStore, dataStore: DataStore, eventLog: EventLog } {
    TestStoreInitializer.messageStore ??= new MessageStoreLevel({
      blockstoreLocation : 'TEST-MESSAGESTORE',
      indexLocation      : 'TEST-INDEX'
    });

    TestStoreInitializer.dataStore ??= new DataStoreLevel({
      blockstoreLocation: 'TEST-DATASTORE'
    });

    TestStoreInitializer.eventLog ??= new EventLogLevel({
      location: 'TEST-EVENTLOG'
    });

    return {
      messageStore : TestStoreInitializer.messageStore,
      dataStore    : TestStoreInitializer.dataStore,
      eventLog     : TestStoreInitializer.eventLog
    };
  }
}