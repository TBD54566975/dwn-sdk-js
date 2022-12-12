import type { AwaitIterable, Batch, KeyQuery, Pair, Query } from 'interface-store';
import type { Blockstore, Options } from 'interface-blockstore';

import { CID } from 'multiformats';
import { Level } from 'level';
import { sleep } from '../utils/time.js';

// `level` works in Node.js 12+ and Electron 5+ on Linux, Mac OS, Windows and
// FreeBSD, including any future Node.js and Electron release thanks to Node-API, including ARM
// platforms like Raspberry Pi and Android, as well as in Chrome, Firefox, Edge, Safari, iOS Safari
//  and Chrome for Android.
export class BlockstoreLevel implements Blockstore {
  db: Level<string, Uint8Array>;

  /**
   * @param location - must be a directory path (relative or absolute) where LevelDB will store its
   * files, or in browsers, the name of
   * the {@link https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase IDBDatabase}
   * to be opened.
   */
  constructor(location: string) {
    this.db = new Level(location, { keyEncoding: 'utf8', valueEncoding: 'binary' });
  }

  async open(): Promise<void> {
    while (this.db.status === 'opening' || this.db.status === 'closing') {
      await sleep(200);
    }

    if (this.db.status === 'open') {
      return;
    }

    // db.open() is automatically called by the database constructor. We're calling it explicitly
    // in order to explicitly catch an error that would otherwise not surface
    // until another method like db.get() is called. Once open() has then been called,
    // any read & write operations will again be queued internally
    // until opening has finished.
    return this.db.open();
  }

  /**
   * releases all file handles and locks held by the underlying db.
   */
  async close(): Promise<void> {
    while (this.db.status === 'opening' || this.db.status === 'closing') {
      await sleep(200);
    }

    if (this.db.status === 'closed') {
      return;
    }

    return this.db.close();
  }

  put(key: CID, val: Uint8Array, _ctx?: Options): Promise<void> {
    return this.db.put(key.toString(), val);
  }

  async get(key: CID, _options?: Options): Promise<Uint8Array | undefined> {
    try {
      const val = await this.db.get(key.toString());
      return val;
    } catch (e) {
      // level throws an error if the key is not present. Return undefined in this case
      if (e.code === 'LEVEL_NOT_FOUND') {
        return undefined;
      } else {
        throw e;
      }
    }
  }

  async has(key: CID, _options?: Options): Promise<boolean> {
    return !! await this.get(key);
  }

  delete(key: CID, _options?: Options): Promise<void> {
    return this.db.del(key.toString());
  }

  async * putMany(source: AwaitIterable<Pair<CID, Uint8Array>>, options?: Options):
    AsyncIterable<Pair<CID, Uint8Array>> {

    for await (const entry of source) {
      await this.put(entry.key, entry.value, options);

      yield entry;
    }
  }

  async * getMany(source: AwaitIterable<CID>, _options?: Options): AsyncIterable<Uint8Array> {
    for await (const key of source) {
      yield this.get(key);
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
  clear(): Promise<void> {
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
}
