import type { AbstractBatchOperation, AbstractDatabaseOptions, AbstractIteratorOptions, AbstractLevel } from 'abstract-level';

import { executeUnlessAborted } from '../utils/abort.js';
import { Level } from 'level';
import { sleep } from '../utils/time.js';

export type CreateLevelDatabaseOptions<V> = AbstractDatabaseOptions<string, V>;

export type LevelDatabase<V> = AbstractLevel<string | Buffer | Uint8Array, string, V>;

export async function createLevelDatabase<V>(location: string, options?: CreateLevelDatabaseOptions<V>): Promise<LevelDatabase<V>> {
  // Only import `'level'` when it's actually necessary (i.e. only when the default `createLevelDatabase` is used).
  // Overriding `createLevelDatabase` will prevent this from happening.
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

    this.db = db!;
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

    return new LevelWrapper(this.config, this.db.sublevel(name, {
      keyEncoding   : 'utf8',
      valueEncoding : this.config.valueEncoding
    }));
  }

  async get(key: string, options?: LevelWrapperOptions): Promise<V|undefined>{
    options?.signal?.throwIfAborted();

    await executeUnlessAborted(this.createLevelDatabase(), options?.signal);

    try {
      const value = await executeUnlessAborted(this.db.get(String(key)), options?.signal);
      return value;
    } catch (error) {
      const e = error as { code: string };
      // `Level`` throws an error if the key is not present.  Return `undefined` in this case.
      if (e.code === 'LEVEL_NOT_FOUND') {
        return undefined;
      } else {
        throw error;
      }
    }
  }

  async has(key: string, options?: LevelWrapperOptions): Promise<boolean> {
    return !! await this.get(key, options);
  }

  async * keys(options?: LevelWrapperOptions): AsyncGenerator<string> {
    options?.signal?.throwIfAborted();

    await executeUnlessAborted(this.createLevelDatabase(), options?.signal);

    for await (const key of this.db.keys()) {
      options?.signal?.throwIfAborted();

      yield key;
    }
  }

  async * iterator(iteratorOptions?: LevelWrapperIteratorOptions<V>, options?: LevelWrapperOptions): AsyncGenerator<[string, V]> {
    options?.signal?.throwIfAborted();

    await executeUnlessAborted(this.createLevelDatabase(), options?.signal);

    for await (const entry of this.db.iterator(iteratorOptions!)) {
      options?.signal?.throwIfAborted();

      yield entry;
    }
  }

  async put(key: string, value: V, options?: LevelWrapperOptions): Promise<void> {
    options?.signal?.throwIfAborted();

    await executeUnlessAborted(this.createLevelDatabase(), options?.signal);

    return executeUnlessAborted(this.db.put(String(key), value), options?.signal);
  }

  async delete(key: string, options?: LevelWrapperOptions): Promise<void> {
    options?.signal?.throwIfAborted();

    await executeUnlessAborted(this.createLevelDatabase(), options?.signal);

    return executeUnlessAborted(this.db.del(String(key)), options?.signal);
  }

  async isEmpty(options?: LevelWrapperOptions): Promise<boolean> {
    for await (const _key of this.keys(options)) {
      return false;
    }
    return true;
  }

  async clear(): Promise<void> {
    await this.createLevelDatabase();

    await this.db.clear();

    await this.compactUnderlyingStorage();
  }

  async batch(operations: Array<LevelWrapperBatchOperation<V>>, options?: LevelWrapperOptions): Promise<void> {
    options?.signal?.throwIfAborted();

    await executeUnlessAborted(this.createLevelDatabase(), options?.signal);

    return executeUnlessAborted(this.db.batch(operations), options?.signal);
  }

  private async compactUnderlyingStorage(options?: LevelWrapperOptions): Promise<void> {
    options?.signal?.throwIfAborted();

    await executeUnlessAborted(this.createLevelDatabase(), options?.signal);

    const range = this.sublevelRange;
    if (!range) {
      return;
    }

    // additional methods are only available on the root API instance
    const root = this.root;

    if (root.db.supports.additionalMethods.compactRange) {
      return executeUnlessAborted((root.db as any).compactRange?.(...range), options?.signal);
    }
  }

  /**
   * Gets the min and max key value of this partition.
   */
  private get sublevelRange(): [ string, string ] | undefined {
    const prefix = (this.db as any).prefix as string;
    if (!prefix) {
      return undefined;
    }

    // derive an exclusive `maxKey` by changing the last prefix character to the immediate succeeding character in unicode
    // (which matches how `abstract-level` creates a `boundary`)
    const maxKey = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
    const minKey = prefix;

    return [minKey, maxKey];
  }

  private get root(): LevelWrapper<V> {
    let db = this.db;
    for (const parent = (db as any).db; parent && parent !== db; ) {
      db = parent;
    }
    return new LevelWrapper(this.config, db);
  }

  private async createLevelDatabase(): Promise<void> {
    this.db ??= await this.config.createLevelDatabase!<V>(this.config.location, {
      keyEncoding   : 'utf8',
      valueEncoding : this.config.valueEncoding
    });
  }

  async dump(): Promise<void> {
    if (!this.db) {
      return;
    }

    for await (const [ key, value ] of this.db.iterator()) {
      console.debug(key, value);
    }
  }
}

type LevelWrapperConfig<V> = CreateLevelDatabaseOptions<V> & {
  location: string,
  createLevelDatabase?: typeof createLevelDatabase,
};