import type { ImportResult } from 'ipfs-unixfs-importer';
import type { DataStore, DataStoreGetResult, DataStorePutResult } from '../types/data-store.js';

import { BlockstoreLevel } from './blockstore-level.js';
import { createLevelDatabase } from './level-wrapper.js';
import { exporter } from 'ipfs-unixfs-exporter';
import { importer } from 'ipfs-unixfs-importer';
import { Readable } from 'readable-stream';

/**
 * A simple implementation of {@link DataStore} that works in both the browser and server-side.
 * Leverages LevelDB under the hood.
 *
 * It has the following structure (`+` represents an additional sublevel/partition):
 *   'data' + <tenant> + <recordId> + <dataCid> -> <data>
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

    this.blockstore = new BlockstoreLevel({
      location            : this.config.blockstoreLocation!,
      createLevelDatabase : this.config.createLevelDatabase,
    });
  }

  public async open(): Promise<void> {
    await this.blockstore.open();
  }

  async close(): Promise<void> {
    await this.blockstore.close();
  }

  async put(tenant: string, recordId: string, dataCid: string, dataStream: Readable): Promise<DataStorePutResult> {
    const blockstoreForData = await this.getBlockstoreForStoringData(tenant, recordId, dataCid);

    const asyncDataBlocks = importer([{ content: dataStream }], blockstoreForData, { cidVersion: 1 });

    // NOTE: the last block contains the root CID as well as info to derive the data size
    let dataDagRoot!: ImportResult;
    for await (dataDagRoot of asyncDataBlocks) { ; }

    return {
      dataSize: Number(dataDagRoot.unixfs?.fileSize() ?? dataDagRoot.size)
    };
  }

  public async get(tenant: string, recordId: string, dataCid: string): Promise<DataStoreGetResult | undefined> {
    const blockstoreForData = await this.getBlockstoreForStoringData(tenant, recordId, dataCid);

    const exists = await blockstoreForData.has(dataCid);
    if (!exists) {
      return undefined;
    }

    // data is chunked into dag-pb unixfs blocks. re-inflate the chunks.
    const dataDagRoot = await exporter(dataCid, blockstoreForData);
    const contentIterator = dataDagRoot.content();

    const dataStream = new Readable({
      async read(): Promise<void> {
        const result = await contentIterator.next();
        if (result.done) {
          this.push(null); // end the stream
        } else {
          this.push(result.value);
        }
      }
    });

    let dataSize = dataDagRoot.size;

    if (dataDagRoot.type === 'file' || dataDagRoot.type === 'directory') {
      dataSize = dataDagRoot.unixfs.fileSize();
    }

    return {
      dataSize: Number(dataSize),
      dataStream,
    };
  }

  public async delete(tenant: string, recordId: string, dataCid: string): Promise<void> {
    const blockstoreForData = await this.getBlockstoreForStoringData(tenant, recordId, dataCid);
    await blockstoreForData.clear();
  }

  /**
   * Deletes everything in the store. Mainly used in tests.
   */
  public async clear(): Promise<void> {
    await this.blockstore.clear();
  }

  /**
   * Gets the blockstore used for storing data for the given `tenant -> `recordId` -> `dataCid`.
   */
  private async getBlockstoreForStoringData(tenant: string, recordId: string, dataCid: string): Promise<BlockstoreLevel> {
    const dataPartitionName = 'data';
    const blockstoreForData = await this.blockstore.partition(dataPartitionName);
    const blockstoreOfGivenTenant = await blockstoreForData.partition(tenant);
    const blockstoreOfGivenRecordId = await blockstoreOfGivenTenant.partition(recordId);
    const blockstoreOfGivenDataCidOfRecordId = await blockstoreOfGivenRecordId.partition(dataCid);
    return blockstoreOfGivenDataCidOfRecordId;
  }
}

type DataStoreLevelConfig = {
  blockstoreLocation?: string,
  createLevelDatabase?: typeof createLevelDatabase,
};