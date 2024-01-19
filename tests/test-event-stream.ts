import type { EventStream } from '../src/index.js';

import { EventEmitterStream } from '../src/index.js';

/**
 * Class that manages the EventStream implementation for testing.
 * This is intended to be extended as the single point of configuration
 * that allows different EventStream implementations to be swapped in
 * to test compatibility with default/built-in implementation.
 */
export class TestEventStream {
  private static eventStream?: EventStream;

  /**
   * Overrides the event stream with a given implementation.
   * If not given, default implementation will be used.
   */
  public static override(overrides?: { eventStream?: EventStream }): void {
    TestEventStream.eventStream = overrides?.eventStream;
  }

  /**
   * Initializes and returns the event stream used for running the test suite.
   */
  public static get(): EventStream {
    TestEventStream.eventStream ??= new EventEmitterStream();
    return TestEventStream.eventStream;
  }
}