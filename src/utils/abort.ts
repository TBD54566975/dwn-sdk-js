/**
 * Wraps the given `AbortSignal` in a `Promise` that rejects if it is programmatically triggered,
 * otherwise the promise will remain in await state (will never resolve).
 */
function promisifySignal<T>(signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    // immediately reject if the given is signal is already aborted
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }

    signal.addEventListener('abort', () => {
      reject(signal.reason);
    });
  });
}

/**
 * Wraps the given `Promise` such that it will reject if the `AbortSignal` is triggered.
 */
export async function executeUnlessAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) {
    return promise;
  }

  return Promise.race([
    promise,
    promisifySignal<T>(signal),
  ]);
}
