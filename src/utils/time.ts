import { Temporal } from '@js-temporal/polyfill';
import { DwnError, DwnErrorCode } from '../index.js';

/**
 * sleeps for the desired duration
 * @param durationInMillisecond the desired amount of sleep time
 * @returns when the provided duration has passed
 */
export function sleep(durationInMillisecond: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, durationInMillisecond));
}

/**
 * returns an UTC ISO-8601 timestamp with microsecond precision
 * using @js-temporal/polyfill
 */
export function getCurrentTimeInHighPrecision(): string {
  return Temporal.Now.instant().toString({ smallestUnit: 'microseconds' });
}

/**
 * Creates a UTC ISO-8601 timestamp in microsecond precision accepted by DWN.
 * @param year
 * @param month
 * @param day
 * @param hour
 * @param minute
 * @param second
 * @param millisecond
 * @param microsecond
 * @returns string
 */
export function createTimestamp(
  year: number, month: number, day: number, hour: number, minute: number, second: number, millisecond: number, microsecond: number
): string {
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
 * We must sleep for at least 2ms to avoid timestamp collisions during testing.
 * https://github.com/TBD54566975/dwn-sdk-js/issues/481
 */
export async function minimalSleep(): Promise<void> {
  await sleep(2);
}

/**
 * Validates that the provided timestamp is a valid number
 * @param timestamp the timestamp to validate
 * @throws DwnError if timestamp is not a valid number
 */
export function validateTimestamp(timestamp: string): void {
  try {
    Temporal.Instant.from(timestamp);
  } catch {
    throw new DwnError(DwnErrorCode.TimestampInvalid, `Invalid timestamp: ${timestamp}`);
  }
}
