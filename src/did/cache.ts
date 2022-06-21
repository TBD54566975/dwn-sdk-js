import NodeCache from 'node-cache';

/**
 * A generalized cache interface.
 */
export interface Cache {
  /**
   * Sets a key-value pair.
   * @returns `true` if key-value pair is stored successfully; `false` otherwise
   */
  set(key: string, value: any): Promise<boolean>;

  /**
   * Gets the value corresponding to the given key.
   * @returns value stored corresponding to the given key; `undefined` if key is not found or expired
   */
  get(key: string): Promise<any | undefined>;
}

/**
 * A cache using local memory.
 */
export class MemoryCache implements Cache {
  private cache: NodeCache;

  /**
   * @param timeToLiveInSeconds time-to-live for every key-value pair set in the cache
   */
  public constructor (private timeToLiveInSeconds: number) {
    this.cache = new NodeCache({
      stdTTL  : timeToLiveInSeconds,
      maxKeys : 100_000
    });
  }

  async set(key: string, value: any): Promise<boolean> {
    return this.cache.set(key, value);
  }

  async get(key: string): Promise<any | undefined> {
    return this.cache.get(key);
  }
}
