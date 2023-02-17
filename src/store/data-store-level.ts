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
  blockstore: BlockstoreLevel;

  constructor(blockstore: BlockstoreLevel) {
    this.blockstore = blockstore;
  }

  public async open(): Promise<void> {
    await this.blockstore.open();
  }

  async close(): Promise<void> {
    await this.blockstore.close();
  }

  async put(tenant: string, recordId: string, dataStream: Readable): Promise<string> {
    const asyncDataBlocks = importer([{ content: dataStream }], this.blockstore, { cidVersion: 1 });

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
    const bytes = await this.blockstore.get(cid);

    if (!bytes) {
      return undefined;
    }

    // data is chunked into dag-pb unixfs blocks. re-inflate the chunks.
    const dataDagRoot = await exporter(dataCid, this.blockstore);
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
