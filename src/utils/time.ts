import { Temporal } from '@js-temporal/polyfill';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

/**
 * Time related utilities.
 */
export class Time {
  /**
   * sleeps for the desired duration
   * @param durationInMillisecond the desired amount of sleep time
   * @returns when the provided duration has passed
   */
  public static async sleep(durationInMillisecond: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, durationInMillisecond));
  }

  /**
   * We must sleep for at least 2ms to avoid timestamp collisions during testing.
   * https://github.com/TBD54566975/dwn-sdk-js/issues/481
   */
  public static async minimalSleep(): Promise<void> {
    await Time.sleep(2);
  }

  /**
   * Returns an UTC ISO-8601 timestamp with microsecond precision accepted by DWN.
   * using @js-temporal/polyfill
   */
  public static getCurrentTimestamp(): string {
    return Temporal.Now.instant().toString({ smallestUnit: 'microseconds' });
  }

  /**
   * Creates a UTC ISO-8601 timestamp in microsecond precision accepted by DWN.
   * @param options - Options for creating the timestamp.
   * @returns string
   */
  public static createTimestamp(options: {
    year?: number, month?: number, day?: number, hour?: number, minute?: number, second?: number, millisecond?: number, microsecond?: number
  }): string {
    const { year, month, day, hour, minute, second, millisecond, microsecond } = options;
    return Temporal.ZonedDateTime.from({
      timeZone: 'UTC',
      year,
      month,
      day,
      hour,
      minute,
      second,
      millisecond,
      microsecond
    }).toInstant().toString({ smallestUnit: 'microseconds' });
  }

  /**
   * Creates a UTC ISO-8601 timestamp offset from now or given timestamp accepted by DWN.
   * @param offset Negative number means offset into the past.
   */
  public static createOffsetTimestamp(offset: { seconds: number }, timestamp?: string): string {
    const timestampInstant = timestamp ? Temporal.Instant.from(timestamp) : Temporal.Now.instant();
    const offsetDuration = Temporal.Duration.from(offset);
    const offsetInstant = timestampInstant.add(offsetDuration);
    return offsetInstant.toString({ smallestUnit: 'microseconds' });
  }

  /**
   * Validates that the provided timestamp is a valid number
   * @param timestamp the timestamp to validate
   * @throws DwnError if timestamp is not a valid number
   */
  public static validateTimestamp(timestamp: string): void {
    try {
      Temporal.Instant.from(timestamp);
    } catch {
      throw new DwnError(DwnErrorCode.TimestampInvalid, `Invalid timestamp: ${timestamp}`);
    }
  }
}
