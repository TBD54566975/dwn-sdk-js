/**
 * Wraps the given `AbortSignal` in a `Promise` that rejects if it is triggered (and will therefore never resolve).
 */
function promisifySignal<Type>(signal: AbortSignal): Promise<Type> {
  return new Promise((resolve, reject) => {
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
export async function abortOr<Type>(signal: AbortSignal | undefined, promise: Promise<Type>): Promise<Type> {
  if (!signal) {
    return promise;
  }

  return Promise.race([
    promise,
    promisifySignal<Type>(signal),
  ]);
}
