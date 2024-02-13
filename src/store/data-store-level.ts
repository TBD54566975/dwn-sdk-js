import type { ImportResult } from 'ipfs-unixfs-importer';
import type { AssociateResult, DataStore, GetResult, PutResult } from '../types/data-store.js';

import { BlockstoreLevel } from './blockstore-level.js';
import { createLevelDatabase } from './level-wrapper.js';
import { exporter } from 'ipfs-unixfs-exporter';
import { importer } from 'ipfs-unixfs-importer';
import { Readable } from 'readable-stream';

// `BlockstoreLevel` doesn't support being a `Set` (i.e. it always requires a value), so use a placeholder instead.
const PLACEHOLDER_VALUE = new Uint8Array();

/**
 * A simple implementation of {@link DataStore} that works in both the browser and server-side.
 * Leverages LevelDB under the hood.
 *
 * It has the following structure (`+` represents a sublevel and `->` represents a key->value pair):
 *   'data' + <tenant> + <dataCid> -> <data>
 *   'references' + <tenant> + <dataCid> + <messageCid> -> PLACEHOLDER_VALUE
 *
 * This allows for the <data> to be shared for everything that uses the same <dataCid> while also making
 * sure that the <data> can only be deleted if there are no <messageCid> for any <tenant> still using it.
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

  async put(tenant: string, messageCid: string, dataCid: string, dataStream: Readable): Promise<PutResult> {
    const blockstoreForReferenceCounting = await this.getBlockstoreForReferenceCounting(tenant, dataCid);
    await blockstoreForReferenceCounting.put(messageCid, PLACEHOLDER_VALUE);

    const blockstoreForData = await this.getBlockstoreForStoringData(tenant, dataCid);

    const asyncDataBlocks = importer([{ content: dataStream }], blockstoreForData, { cidVersion: 1 });

    // NOTE: the last block contains the root CID as well as info to derive the data size
    let dataDagRoot!: ImportResult;
    for await (dataDagRoot of asyncDataBlocks) { ; }

    return {
      dataCid  : String(dataDagRoot.cid),
      dataSize : Number(dataDagRoot.unixfs?.fileSize() ?? dataDagRoot.size)
    };
  }

  public async get(tenant: string, messageCid: string, dataCid: string): Promise<GetResult | undefined> {
    const blockstoreForReferenceCounting = await this.getBlockstoreForReferenceCounting(tenant, dataCid);

    const allowed = await blockstoreForReferenceCounting.has(messageCid);
    if (!allowed) {
      return undefined;
    }

    const blockstoreForData = await this.getBlockstoreForStoringData(tenant, dataCid);

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
      dataCid  : String(dataDagRoot.cid),
      dataSize : Number(dataSize),
      dataStream,
    };
  }

  public async associate(tenant: string, messageCid: string, dataCid: string): Promise<AssociateResult | undefined> {
    const blockstoreForReferenceCounting = await this.getBlockstoreForReferenceCounting(tenant, dataCid);

    const noExistingReference = await blockstoreForReferenceCounting.isEmpty();
    if (noExistingReference) {
      return undefined;
    }

    const blockstoreForData = await this.getBlockstoreForStoringData(tenant, dataCid);

    const dataExists = await blockstoreForData.has(dataCid);
    if (!dataExists) {
      return undefined;
    }

    await blockstoreForReferenceCounting.put(messageCid, PLACEHOLDER_VALUE);

    const dataDagRoot = await exporter(dataCid, blockstoreForData);

    let dataSize = dataDagRoot.size;

    if (dataDagRoot.type === 'file' || dataDagRoot.type === 'directory') {
      dataSize = dataDagRoot.unixfs.fileSize();
    }

    return {
      dataCid  : String(dataDagRoot.cid),
      dataSize : Number(dataSize)
    };
  }

  public async delete(tenant: string, messageCid: string, dataCid: string): Promise<void> {
    const blockstoreForReferenceCounting = await this.getBlockstoreForReferenceCounting(tenant, dataCid);
    await blockstoreForReferenceCounting.delete(messageCid);

    const wasLastReference = await blockstoreForReferenceCounting.isEmpty();
    if (!wasLastReference) {
      return;
    }

    const blockstoreForData = await this.getBlockstoreForStoringData(tenant, dataCid);
    await blockstoreForData.clear();
  }

  /**
   * Deletes everything in the store. Mainly used in tests.
   */
  public async clear(): Promise<void> {
    await this.blockstore.clear();
  }

  /**
   * Gets the blockstore used for reference counting purposes for the given `dataCid` in the given `tenant`.
   */
  private async getBlockstoreForReferenceCounting(tenant: string, dataCid: string): Promise<BlockstoreLevel> {
    const referenceCountingPartitionName = 'references';
    const blockstoreForReferenceCounting = await this.blockstore.partition(referenceCountingPartitionName);
    const blockstoreForReferenceCountingByTenant = await blockstoreForReferenceCounting.partition(tenant);
    const blockstoreForReferenceCountingDataCid = await blockstoreForReferenceCountingByTenant.partition(dataCid);
    return blockstoreForReferenceCountingDataCid;
  }

  /**
   * Gets the blockstore used for storing data for the given `dataCid` in the given `tenant`.
   */
  private async getBlockstoreForStoringData(tenant: string, dataCid: string): Promise<BlockstoreLevel> {
    const dataPartitionName = 'data';
    const blockstoreForData = await this.blockstore.partition(dataPartitionName);
    const blockstoreOfGivenTenant = await blockstoreForData.partition(tenant);
    const blockstoreOfGivenDataCid = await blockstoreOfGivenTenant.partition(dataCid);
    return blockstoreOfGivenDataCid;
  }
}

type DataStoreLevelConfig = {
  blockstoreLocation?: string,
  createLevelDatabase?: typeof createLevelDatabase,
};