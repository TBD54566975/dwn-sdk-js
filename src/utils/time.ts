/**
 * sleeps for the desired duration
 * @param durationInMillisecond the desired amount of sleep time
 * @returns when the provided duration has passed
 */
export function sleep(durationInMillisecond): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, durationInMillisecond));
}