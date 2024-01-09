import type { EventStream } from '../src/index.js';
import { EventStreamEmitter } from '../src/index.js';

/**
 * Class that manages store implementations for testing.
 * This is intended to be extended as the single point of configuration
 * that allows different store implementations to be swapped in
 * to test compatibility with default/built-in store implementations.
 */
export class TestEventStream {
  private static eventStream?: EventStream;

  /**
   * Overrides test stores with given implementation.
   * If not given, default implementation will be used.
   */
  public static override(overrides?: { eventStream?: EventStream }): void {
    TestEventStream.eventStream = overrides?.eventStream;
  }

  /**
   * Initializes and return the stores used for running the test suite.
   */
  public static get(): EventStream {
    TestEventStream.eventStream ??= new EventStreamEmitter();
    return TestEventStream.eventStream;
  }
}