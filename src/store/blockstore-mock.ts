import { CID } from 'multiformats';
import type { AbortOptions, AwaitIterable } from 'interface-store';
import type { Blockstore, Pair } from 'interface-blockstore';

/**
 * Mock implementation for the Blockstore interface.
 *
 * WARNING!!! Purely to be used with `ipfs-unixfs-importer` to compute CID without needing consume any memory.
 * This is particularly useful when dealing with large files and a necessity in a large-scale production service environment.
 */
export class BlockstoreMock implements Blockstore {

  async open(): Promise<void> {
  }

  async close(): Promise<void> {
  }

  async put(key: CID, _val: Uint8Array, _options?: AbortOptions): Promise<CID> {
    return key;
  }

  async get(_key: CID, _options?: AbortOptions): Promise<Uint8Array> {
    return new Uint8Array();
  }

  async has(_key: CID, _options?: AbortOptions): Promise<boolean> {
    return false;
  }

  async delete(_key: CID, _options?: AbortOptions): Promise<void> {
  }

  async isEmpty(_options?: AbortOptions): Promise<boolean> {
    return true;
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
  }
}
