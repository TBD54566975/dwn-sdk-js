import LruCache from 'lru-cache';
import type { Cache } from './types';

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

  async set(key: string, value: any): Promise<boolean> {
    this.cache.set(key, value);
    return true;
  }

  async get(key: string): Promise<any | undefined> {
    return this.cache.get(key);
  }
}
