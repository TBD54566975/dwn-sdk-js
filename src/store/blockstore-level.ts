import type { CID } from 'multiformats';
import type { AwaitIterable, Batch, KeyQuery, Pair, Query } from 'interface-store';
import type { Blockstore, Options } from 'interface-blockstore';

import { createLevelDatabase, LevelWrapper } from './level-wrapper.js';

type Key = CID | string | number;

// `level` works in Node.js 12+ and Electron 5+ on Linux, Mac OS, Windows and
// FreeBSD, including any future Node.js and Electron release thanks to Node-API, including ARM
// platforms like Raspberry Pi and Android, as well as in Chrome, Firefox, Edge, Safari, iOS Safari
//  and Chrome for Android.

/**
 * Blockstore implementation using LevelDB for storing the actual messages (in the case of MessageStore)
 * or the data associated with messages (in the case of a DataStore).
 */
export class BlockstoreLevel implements Blockstore {
  config: BlockstoreLevelConfig;

  db: LevelWrapper<Uint8Array>;

  constructor(config: BlockstoreLevelConfig, db?: LevelWrapper<Uint8Array>) {
    this.config = {
      createLevelDatabase,
      ...config
    };

    this.db = db ?? new LevelWrapper<Uint8Array>({ ...this.config, valueEncoding: 'binary' });
  }

  async open(): Promise<void> {
    return this.db.open();
  }

  async close(): Promise<void> {
    return this.db.close();
  }

  async partition(name: Key): Promise<BlockstoreLevel> {
    const db = await this.db.partition(String(name));
    return new BlockstoreLevel({ ...this.config, location: '' }, db);
  }

  async put(key: Key, val: Uint8Array, options?: Options): Promise<void> {
    return this.db.put(String(key), val, options);
  }

  async get(key: Key, options?: Options): Promise<Uint8Array> {
    return this.db.get(String(key), options);
  }

  async has(key: Key, options?: Options): Promise<boolean> {
    return this.db.has(String(key), options);
  }

  async * iterator(options?: Options): AsyncGenerator<[string, Uint8Array]> {
    for await (const entry of this.db.iterator({ }, options)) {
      yield entry;
    }
  }

  async delete(key: Key, options?: Options): Promise<void> {
    return this.db.delete(String(key), options);
  }

  async isEmpty(options?: Options): Promise<boolean> {
    return this.db.isEmpty(options);
  }

  async * putMany(source: AwaitIterable<Pair<CID, Uint8Array>>, options?: Options):
    AsyncIterable<Pair<CID, Uint8Array>> {

    for await (const entry of source) {
      await this.put(entry.key, entry.value, options);

      yield entry;
    }
  }

  async * getMany(source: AwaitIterable<CID>, options?: Options): AsyncIterable<Uint8Array> {
    for await (const key of source) {
      yield this.get(key, options);
    }
  }

  async * deleteMany(source: AwaitIterable<CID>, options?: Options): AsyncIterable<CID> {
    for await (const key of source) {
      await this.delete(key, options);

      yield key;
    }
  }

  /**
   * deletes all entries
   */
  async clear(): Promise<void> {
    return this.db.clear();
  }

  batch(): Batch<CID, Uint8Array> {
    throw new Error('not implemented');
  }

  query(_query: Query<CID, Uint8Array>, _options?: Options): AsyncIterable<Pair<CID, Uint8Array>> {
    throw new Error('not implemented');
  }

  queryKeys(_query: KeyQuery<CID>, _options?: Options): AsyncIterable<CID> {
    throw new Error('not implemented');
  }

  async dump(): Promise<void> {
    console.group('db');
    await this.db['dump']?.();
    console.groupEnd();
  }
}

type BlockstoreLevelConfig = {
  location: string,
  createLevelDatabase?: typeof createLevelDatabase,
};