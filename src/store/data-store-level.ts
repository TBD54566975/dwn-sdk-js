import type { DataStore } from './data-store.js';
import type { ImportResult } from 'ipfs-unixfs-importer';
import type { PutResult } from './data-store.js';

import { BlockstoreLevel } from './blockstore-level.js';
import { createLevelDatabase } from './level-wrapper.js';
import { exporter } from 'ipfs-unixfs-exporter';
import { importer } from 'ipfs-unixfs-importer';
import { Readable } from 'readable-stream';

const DATA_PARTITION = 'data';
const HOST_PARTITION = 'host';

// `BlockstoreLevel` doesn't support being a `Set` (i.e. it always requires a value), so use a placeholder instead.
const PLACEHOLDER_VALUE = new Uint8Array();

/**
 * A simple implementation of {@link DataStore} that works in both the browser and server-side.
 * Leverages LevelDB under the hood.
 *
 * It has the following structure (`+` represents a sublevel and `->` represents a key->value pair):
 *   'data' + <dataCid> -> <data>
 *   'host' + <dataCid> + <tenant> + <messageCid> -> PLACEHOLDER_VALUE
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
      location            : this.config.blockstoreLocation,
      createLevelDatabase : this.config.createLevelDatabase,
    });
  }

  public async open(): Promise<void> {
    await this.blockstore.open();
  }

  async close(): Promise<void> {
    await this.blockstore.close();
  }

  async put(tenant: string, messageCid: string, dataStream: Readable): Promise<PutResult> {
    const dataPartition = await this.blockstore.partition(DATA_PARTITION);

    const asyncDataBlocks = importer([{ content: dataStream }], dataPartition, { cidVersion: 1 });

    // NOTE: the last block contains the root CID as well as info to derive the data size
    let block: ImportResult;
    for await (block of asyncDataBlocks) { ; }

    const dataCid = block.cid.toString();
    const dataSize = block.unixfs ? Number(block.unixfs!.fileSize()) : Number(block.size);

    const tenantsForData = await this.blockstore.partition(HOST_PARTITION);
    const messagesForTenant = await tenantsForData.partition(dataCid);
    const messages = await messagesForTenant.partition(tenant);

    await messages.put(messageCid, PLACEHOLDER_VALUE);

    return {
      dataCid,
      dataSize
    };
  }

  public async get(tenant: string, messageCid: string, dataCid: string): Promise<Readable | undefined> {
    const tenantsForData = await this.blockstore.partition(HOST_PARTITION);
    const messagesForTenant = await tenantsForData.partition(dataCid);
    const messages = await messagesForTenant.partition(tenant);

    const allowed = await messages.has(messageCid);
    if (!allowed) {
      return undefined;
    }

    const dataPartition = await this.blockstore.partition(DATA_PARTITION);

    const bytes = await dataPartition.get(dataCid);

    if (!bytes) {
      return undefined;
    }

    // data is chunked into dag-pb unixfs blocks. re-inflate the chunks.
    const dataDagRoot = await exporter(dataCid, dataPartition);
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

  public async associate(tenant: string, messageCid: string, dataCid: string): Promise<boolean> {
    const dataPartition = await this.blockstore.partition(DATA_PARTITION);

    const exists = await dataPartition.has(dataCid);
    if (!exists) {
      return false;
    }

    const tenantsForData = await this.blockstore.partition(HOST_PARTITION);
    const messagesForTenant = await tenantsForData.partition(dataCid);
    const messages = await messagesForTenant.partition(tenant);

    const isFirstMessage = await messages.isEmpty();
    if (isFirstMessage) {
      return false;
    }

    await messages.put(messageCid, PLACEHOLDER_VALUE);

    return true;
  }

  public async delete(tenant: string, messageCid: string, dataCid: string): Promise<void> {
    const tenantsForData = await this.blockstore.partition(HOST_PARTITION);
    const messagesForTenant = await tenantsForData.partition(dataCid);
    const messages = await messagesForTenant.partition(tenant);

    await messages.delete(messageCid);

    const wasLastMessage = await messages.isEmpty();
    if (!wasLastMessage) {
      return;
    }

    await messagesForTenant.delete(tenant);

    const wasLastTenant = await messagesForTenant.isEmpty();
    if (!wasLastTenant) {
      return;
    }

    await tenantsForData.delete(dataCid);

    const dataPartition = await this.blockstore.partition(DATA_PARTITION);

    await dataPartition.delete(dataCid);
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