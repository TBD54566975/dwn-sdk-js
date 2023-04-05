import { Temporal } from '@js-temporal/polyfill';

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
