import { BlockstoreLevel } from './blockstore-level.js';
import { CID } from 'multiformats/cid';
import { DataStore } from './data-store.js';
import { exporter } from 'ipfs-unixfs-exporter';
import { importer } from 'ipfs-unixfs-importer';
import { Readable } from 'readable-stream';

/**
 * A simple implementation of {@link MessageStore} that works in both the browser and server-side.
 * Leverages LevelDB under the hood.
 */
export class DataStoreLevel implements DataStore {
  private static readonly dataStoreName = 'DATASTORE';

  db: BlockstoreLevel;

  constructor() {
    this.db = new BlockstoreLevel(DataStoreLevel.dataStoreName);
  }

  public async open(): Promise<void> {
    if (!this.db) {
      this.db = new BlockstoreLevel(DataStoreLevel.dataStoreName);
    }

    await this.db.open();
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  async put(tenant: string, recordId: string, dataStream: Readable): Promise<string> {
    const asyncDataBlocks = importer([{ content: dataStream }], this.db, { cidVersion: 1 });

    // NOTE: the last block contains the root CID
    let block;
    for await (block of asyncDataBlocks) { ; }

    // MUST verify that the CID of the actual data matches with the given `dataCid`
    // if data CID is wrong, delete the data we just stored
    const dataCid = block.cid.toString();
    return dataCid;
  }

  public async get(tenant: string, recordId: string, dataCid: string): Promise<Uint8Array | undefined> {
    const cid = CID.parse(dataCid);
    const bytes = await this.db.get(cid);

    if (!bytes) {
      return undefined;
    }

    // data is chunked into dag-pb unixfs blocks. re-inflate the chunks.
    const dataDagRoot = await exporter(dataCid, this.db);
    const dataBytes = new Uint8Array(dataDagRoot.size);
    let offset = 0;

    for await (const chunk of dataDagRoot.content()) {
      dataBytes.set(chunk, offset);
      offset += chunk.length;
    }

    return dataBytes;
  }

  async delete(tenant: string, recordId: string, dataCid: string): Promise<void> {
    // TODO: Implement data deletion in Records - https://github.com/TBD54566975/dwn-sdk-js/issues/84
    const cid = CID.parse(dataCid);
    await this.db.delete(cid);
    return;
  }

  /**
   * Deletes everything in the store. Mainly used in tests.
   */
  public async clear(): Promise<void> {
    await this.db.clear();
  }
}
