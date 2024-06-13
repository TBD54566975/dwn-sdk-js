import { Time } from '../../src/utils/time.js';

export class TestTimingUtils {

  static async pollUntilSuccessOrTimeout(
    delegate: () => Promise<any>,
    retrySleep: number = 50,
    timeout: number = 5000
  ): Promise<any> {
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