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

    await abortOr(options?.signal, this.createLevelDatabase());

    try {
      const value = await abortOr(options?.signal, this.db.get(String(key)));
      return value;
    } catch (error) {
      const e = error as any; // FIXME
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

    await abortOr(options?.signal, this.createLevelDatabase());

    for await (const key of this.db.keys()) {
      options?.signal?.throwIfAborted();

      yield key;
    }
  }

  async * iterator(iteratorOptions?: LevelWrapperIteratorOptions<V>, options?: LevelWrapperOptions): AsyncGenerator<[string, V]> {
    options?.signal?.throwIfAborted();

    await abortOr(options?.signal, this.createLevelDatabase());

    for await (const entry of this.db.iterator(iteratorOptions!)) {
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

    await abortOr(options?.signal, this.createLevelDatabase());

    return abortOr(options?.signal, this.db.batch(operations));
  }

  private async compactUnderlyingStorage(options?: LevelWrapperOptions): Promise<void> {
    options?.signal?.throwIfAborted();

    await abortOr(options?.signal, this.createLevelDatabase());

    const range = this.sublevelRange;
    if (!range) {
      return;
    }

    // additional methods are only available on the root API instance
    const root = this.root;

    if (root.db.supports.additionalMethods.compactRange) {
      return abortOr(options?.signal, (root.db as any).compactRange?.(...range));
    }
  }

  private get sublevelRange(): [ string, string ] | undefined {
    const prefix = (this.db as any).prefix;
    if (!prefix) {
      return undefined;
    }

    // use the separator to derive an exclusive `end` that will never match to a key (which matches how `abstract-level` creates a `boundary`)
    return [ prefix, prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1) ];
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