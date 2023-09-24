import { EventStreamI } from '../src/event-log/event-stream.js';
import type { DataStore, EventLog, MessageStore } from '../src/index.js';
import { DataStoreLevel, EventLogLevel, MessageStoreLevel } from '../src/index.js';

/**
 * Class that manages store implementations for testing.
 * This is intended to be extended as the single point of configuration
 * that allows different store implementations to be swapped in
 * to test compatibility with default/built-in store implementations.
 */
export class TestStores {

  private static messageStore?: MessageStore;
  private static dataStore?: DataStore;
  private static eventLog?: EventLog;
  private static eventStream?: EventStreamI;

  /**
   * Overrides test stores with given implementation.
   * If not given, default implementation will be used.
   */
  public static override(overrides?: { messageStore?: MessageStore, dataStore?: DataStore, eventLog?: EventLog, eventStream?: EventStreamI }): void {
    TestStores.messageStore = overrides?.messageStore;
    TestStores.dataStore = overrides?.dataStore;
    TestStores.eventLog = overrides?.eventLog;
    TestStores.eventStream = overrides?.eventStream;
  }

  /**
   * Initializes and return the stores used for running the test suite.
   */
  public static get(): { messageStore: MessageStore, dataStore: DataStore, eventLog: EventLog, eventStream?: EventStreamI} {
    TestStores.messageStore ??= new MessageStoreLevel({
      blockstoreLocation : 'TEST-MESSAGESTORE',
      indexLocation      : 'TEST-INDEX'
    });

    TestStores.dataStore ??= new DataStoreLevel({
      blockstoreLocation: 'TEST-DATASTORE'
    });

    TestStores.eventLog ??= new EventLogLevel({
      location: 'TEST-EVENTLOG'
    });

    return {
      messageStore : TestStores.messageStore,
      dataStore    : TestStores.dataStore,
      eventLog     : TestStores.eventLog,
      eventStream :  TestStores.eventStream 
    };
  }
}