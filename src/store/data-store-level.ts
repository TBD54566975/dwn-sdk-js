import type { ImportResult } from 'ipfs-unixfs-importer';
import type { PutResult } from './data-store.js';

import { BlockstoreLevel } from './blockstore-level.js';
import { CID } from 'multiformats/cid';
import { createLevelDatabase } from './create-level.js';
import { DataStore } from './data-store.js';
import { exporter } from 'ipfs-unixfs-exporter';
import { importer } from 'ipfs-unixfs-importer';
import { Readable } from 'readable-stream';

/**
 * A simple implementation of {@link DataStore} that works in both the browser and server-side.
 * Leverages LevelDB under the hood.
 */
export class DataStoreLevel implements DataStore {
  config: DataStoreLevelConfig;

  blockstore: BlockstoreLevel;

  constructor(config: DataStoreLevelConfig = {}) {
    this.config = {
      blockstoreLocation: 'DATASTORE',
      createLevelDatabase,
      ...config
    };

    this.blockstore = new BlockstoreLevel(this.config.blockstoreLocation, {
      createLevelDatabase: this.config.createLevelDatabase,
    });
  }

  public async open(): Promise<void> {
    await this.blockstore.open();
  }

  async close(): Promise<void> {
    await this.blockstore.close();
  }

  public async put(tenant: string, recordId: string, dataStream: Readable): Promise<PutResult> {
    const asyncDataBlocks = importer([{ content: dataStream }], this.blockstore, { cidVersion: 1 });

    // NOTE: the last block contains the root CID as well as info to derive the data size
    let block: ImportResult;
    for await (block of asyncDataBlocks) { ; }

    const dataCid = block.cid.toString();
    const dataSize = block.unixfs ? Number(block.unixfs!.fileSize()) : Number(block.size);

    return {
      dataCid,
      dataSize
    };
  }

  public async get(tenant: string, recordId: string, dataCid: string): Promise<Readable | undefined> {
    const cid = CID.parse(dataCid);
    const bytes = await this.blockstore.get(cid);

    if (!bytes) {
      return undefined;
    }

    // data is chunked into dag-pb unixfs blocks. re-inflate the chunks.
    const dataDagRoot = await exporter(dataCid, this.blockstore);
    const contentIterator = dataDagRoot.content()[Symbol.asyncIterator]();

    const readableStream = new Readable({
      async read(): Promise<void> {
        const result = await contentIterator.next();
        if (result.done) {
          this.push(null); // end the stream
        } else {
          this.push(result.value);
        }
      }
    });

    return readableStream;
  }

  public async has(tenant: string, recordId: string, dataCid: string): Promise<boolean> {
    const cid = CID.parse(dataCid);
    const rootBlockBytes = await this.blockstore.get(cid);

    return (rootBlockBytes !== undefined);
  }

  public async delete(tenant: string, recordId: string, dataCid: string): Promise<void> {
    // TODO: Implement data deletion in Records - https://github.com/TBD54566975/dwn-sdk-js/issues/84
    const cid = CID.parse(dataCid);
    await this.blockstore.delete(cid);
    return;
  }

  /**
   * Deletes everything in the store. Mainly used in tests.
   */
  public async clear(): Promise<void> {
    await this.blockstore.clear();
  }
}

type DataStoreLevelConfig = {
  blockstoreLocation?: string,
  createLevelDatabase?: typeof createLevelDatabase,
};