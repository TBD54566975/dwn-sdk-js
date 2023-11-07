import { CID } from 'multiformats';
import type { AbortOptions, AwaitIterable } from 'interface-store';
import type { Blockstore, Pair } from 'interface-blockstore';

import { createLevelDatabase, LevelWrapper } from './level-wrapper.js';

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

  async partition(name: string): Promise<BlockstoreLevel> {
    const db = await this.db.partition(name);
    return new BlockstoreLevel({ ...this.config, location: '' }, db);
  }

  async put(key: CID | string, val: Uint8Array, options?: AbortOptions): Promise<CID> {
    await this.db.put(String(key), val, options);
    return CID.parse(key.toString());
  }

  async get(key: CID | string, options?: AbortOptions): Promise<Uint8Array> {
    const result = await this.db.get(String(key), options);
    return result!;
  }

  async has(key: CID | string, options?: AbortOptions): Promise<boolean> {
    return this.db.has(String(key), options);
  }

  async delete(key: CID | string, options?: AbortOptions): Promise<void> {
    return this.db.delete(String(key), options);
  }

  async isEmpty(options?: AbortOptions): Promise<boolean> {
    return this.db.isEmpty(options);
  }

  async * putMany(source: AwaitIterable<Pair>, options?: AbortOptions): AsyncIterable<CID> {
    for await (const entry of source) {
      await this.put(entry.cid, entry.block, options);

      yield entry.cid;
    }
  }

  async * getMany(source: AwaitIterable<CID>, options?: AbortOptions): AsyncIterable<Pair> {
    for await (const key of source) {
      yield {
        cid   : key,
        block : await this.get(key, options)
      };
    }
  }

  async * getAll(options?: AbortOptions): AsyncIterable<Pair> {
    // @ts-expect-error keyEncoding is 'buffer' but types for db.iterator always return the key type as 'string'
    const li: AsyncGenerator<[Uint8Array, Uint8Array]> = this.db.iterator({
      keys        : true,
      keyEncoding : 'buffer'
    }, options);

    for await (const [key, value] of li) {
      yield { cid: CID.decode(key), block: value };
    }
  }

  async * deleteMany(source: AwaitIterable<CID>, options?: AbortOptions): AsyncIterable<CID> {
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
}

type BlockstoreLevelConfig = {
  location: string,
  createLevelDatabase?: typeof createLevelDatabase,
};