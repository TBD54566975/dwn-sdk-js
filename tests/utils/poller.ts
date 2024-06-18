import { Time } from '../../src/utils/time.js';

export class Poller {

  /**
   * The interval in milliseconds to wait before retrying the delegate function.
   */
  static pollRetrySleep: number = 20;

  /**
   * The maximum time in milliseconds to wait before timing out the delegate function.
   */
  static pollTimeout: number = 2000;

  /**
   *  Polls the delegate function until it succeeds or the timeout is exceeded.
   *
   * @param delegate a function that returns a promise and may throw.
   * @param retrySleep the interval in milliseconds to wait before retrying the delegate function.
   * @param timeout the maximum time in milliseconds to wait before timing out the delegate function.
   *
   * @throws {Error} `Operation timed out` if the timeout is exceeded.
   */
  static async pollUntilSuccessOrTimeout<T>(
    delegate: () => Promise<T>,
    retrySleep: number = Poller.pollRetrySleep,
    timeout: number = Poller.pollTimeout,
  ): Promise<T> {
    const startTime = Date.now();

    while (true) {
      try {
        // Attempt to execute the delegate function
        return await delegate();
      } catch (error) {
        // Check if the timeout has been exceeded
        if (Date.now() - startTime >= timeout) {
          throw new Error('Operation timed out');
        }

        // Sleep for the retry interval before attempting again
        await Time.sleep(retrySleep);
      }
    }
  }
}