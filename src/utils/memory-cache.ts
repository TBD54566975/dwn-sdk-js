import type { Cache } from './types.js';
import LruCache from 'lru-cache';

/**
 * A cache using local memory.
 */
export class MemoryCache implements Cache {
  private cache: LruCache<string, any>;

  /**
   * @param timeToLiveInSeconds time-to-live for every key-value pair set in the cache
   */
  public constructor (private timeToLiveInSeconds: number) {
    this.cache = new LruCache({
      max : 100_000,
      ttl : timeToLiveInSeconds * 1000
    });
  }

  async set(key: string, value: any): Promise<void> {
    try {
      this.cache.set(key, value);
    } catch {
      // let the code continue as this is a non-fatal error
    }
  }

  async get(key: string): Promise<any | undefined> {
    return this.cache.get(key);
  }

  async dump(): Promise<void> {
    for (const [ key, value ] of this.cache) {
      console.debug(key, value);
    }
  }
}
