import type { AbstractBatchOperation, AbstractDatabaseOptions, AbstractIteratorOptions, AbstractLevel } from 'abstract-level';

import { abortOr } from '../utils/abort.js';
import { sleep } from '../utils/time.js';

export type CreateLevelDatabaseOptions<V> = AbstractDatabaseOptions<string, V>;

export type LevelDatabase<V> = AbstractLevel<string | Buffer | Uint8Array, string, V>;

export async function createLevelDatabase<V>(location: string, options?: CreateLevelDatabaseOptions<V>): Promise<LevelDatabase<V>> {
  // Only import `'level'` when it's actually necessary (i.e. only when the default `createLevelDatabase` is used).
  // Overriding `createLevelDatabase` will prevent this from happening.
  const { Level } = await import('level');
  return new Level(location, { ...options, keyEncoding: 'utf8' });
}

export interface LevelWrapperOptions {
  signal?: AbortSignal;
}

export type LevelWrapperBatchOperation<V> = AbstractBatchOperation<LevelDatabase<V>, string, V>;

export type LevelWrapperIteratorOptions<V> = AbstractIteratorOptions<string, V>;

// `Level` works in Node.js 12+ and Electron 5+ on Linux, Mac OS, Windows and FreeBSD, including any
// future Node.js and Electron release thanks to Node-API, including ARM platforms like Raspberry Pi
// and Android, as well as in Chrome, Firefox, Edge, Safari, iOS Safari and Chrome for Android.
export class LevelWrapper<V> {
  config: LevelWrapperConfig<V>;

  db: LevelDatabase<V>;

  /**
   * @param config.location - must be a directory path (relative or absolute) where `Level`` will
   * store its files, or in browsers, the name of the {@link https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase `IDBDatabase`}
   * to be opened.
   */
  constructor(config: LevelWrapperConfig<V>, db?: LevelDatabase<V>) {
    this.config = {
      createLevelDatabase,
      ...config
    };

    this.db = db;
  }

  async open(): Promise<void> {
    await this.createLevelDatabase();

    while (this.db.status === 'opening' || this.db.status === 'closing') {
      await sleep(200);
    }

    if (this.db.status === 'open') {
      return;
    }

    // `db.open()` is automatically called by the database constructor.  We're calling it explicitly
    // in order to explicitly catch an error that would otherwise not surface until another method
    // like `db.get()` is called.  Once `db.open()` has then been called, any read & write
    // operations will again be queued internally until opening has finished.
    return this.db.open();
  }

  async close(): Promise<void> {
    if (!this.db) {
      return;
    }

    while (this.db.status === 'opening' || this.db.status === 'closing') {
      await sleep(200);
    }

    if (this.db.status === 'closed') {
      return;
    }

    return this.db.close();
  }

  async partition(name: string): Promise<LevelWrapper<V>> {
    await this.createLevelDatabase();

    return new LevelWrapper({ ...this.config, location: '' }, this.db.sublevel(name, {
      keyEncoding   : 'utf8',
      valueEncoding : this.config.valueEncoding
    }));
  }

  async get(key: string, options?: LevelWrapperOptions): Promise<V> {
    options?.signal?.throwIfAborted();

    await abortOr(options?.signal, this.createLevelDatabase());

    try {
      const value = await abortOr(options?.signal, this.db.get(String(key)));
      return value;
    } catch (error) {
      // `Level`` throws an error if the key is not present.  Return `undefined` in this case.
      if (error.code === 'LEVEL_NOT_FOUND') {
        return undefined;
      } else {
        throw error;
      }
    }
  }

  async * keys(options?: LevelWrapperOptions): AsyncGenerator<string> {
    options?.signal?.throwIfAborted();

    await abortOr(options?.signal, this.createLevelDatabase());

    for await (const key of this.db.keys()) {
      options?.signal?.throwIfAborted();

      yield key;
    }
  }

  async * iterator(iteratorOptions: LevelWrapperIteratorOptions<V>, options?: LevelWrapperOptions): AsyncGenerator<[string, V]> {
    options?.signal?.throwIfAborted();

    await abortOr(options?.signal, this.createLevelDatabase());

    for await (const entry of this.db.iterator(iteratorOptions)) {
      options?.signal?.throwIfAborted();

      yield entry;
    }
  }

  async put(key: string, value: V, options?: LevelWrapperOptions): Promise<void> {
    options?.signal?.throwIfAborted();

    await abortOr(options?.signal, this.createLevelDatabase());

    return abortOr(options?.signal, this.db.put(String(key), value));
  }

  async delete(key: string, options?: LevelWrapperOptions): Promise<void> {
    options?.signal?.throwIfAborted();

    await abortOr(options?.signal, this.createLevelDatabase());

    return abortOr(options?.signal, this.db.del(String(key)));
  }

  async clear(): Promise<void> {
    await this.createLevelDatabase();

    return this.db.clear();
  }

  async batch(operations: Array<LevelWrapperBatchOperation<V>>, options?: LevelWrapperOptions): Promise<void> {
    options?.signal?.throwIfAborted();

    await abortOr(options?.signal, this.createLevelDatabase());

    return abortOr(options?.signal, this.db.batch(operations));
  }

  private async createLevelDatabase(): Promise<void> {
    this.db ??= await this.config.createLevelDatabase<V>(this.config.location, {
      keyEncoding   : 'utf8',
      valueEncoding : this.config.valueEncoding
    });
  }
}

type LevelWrapperConfig<V> = CreateLevelDatabaseOptions<V> & {
  location: string,
  createLevelDatabase?: typeof createLevelDatabase,
};