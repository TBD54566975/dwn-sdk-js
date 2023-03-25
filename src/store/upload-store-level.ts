import type { ImportResult } from 'ipfs-unixfs-importer';
import type { Readable } from 'readable-stream';
import type { UnixFSEntry } from 'ipfs-unixfs-exporter';
import type { UploadCompleteResult, UploadPartResult, UploadStore, UploadStoreOptions } from './upload-store.js';

import { abortOr } from '../utils/abort.js';
import { BlockstoreLevel } from './blockstore-level.js';
import { Cid } from '../utils/cid.js';
import { createLevelDatabase } from './level-wrapper.js';
import { DataStream } from '../utils/data-stream.js';
import { Encoder } from '../utils/encoder.js';
import { exporter } from 'ipfs-unixfs-exporter';
import { importer } from 'ipfs-unixfs-importer';
import { sum } from '../utils/array.js';

const DATA_PARTITION = 'data';
const ROOT_PARTITION = 'root';

/**
 * A simple implementation of {@link UploadStore} that works in both the browser and server-side.
 * Leverages LevelDB under the hood.
 *
 * It has the following structure (`+` represents a sublevel and `->` represents a key->value pair):
 *   '<tenant>' + <recordId> + 'data' + <index> -> <data>
 *   '<tenant>' + <recordId> + 'root' + <index> -> <dataCid>
 *
 * This allows for the <data> to be stored without having to provide it's `<dataCid>` upfront, which
 * is especially necessary when getting _all_ the data for a <recordId> for a <tenant>, as the root
 * <dataCid> can be retrieved for each <index> internally (i.e. not needing the client to provide
 * each <dataCid> for each part).
 */
export class UploadStoreLevel implements UploadStore {
  config: UploadStoreLevelConfig;

  blockstore: BlockstoreLevel;

  constructor(config: UploadStoreLevelConfig = { }) {
    this.config = {
      blockstoreLocation: 'UPLOADSTORE',
      createLevelDatabase,
      ...config
    };

    this.blockstore = new BlockstoreLevel({
      location            : this.config.blockstoreLocation,
      createLevelDatabase : this.config.createLevelDatabase,
    });
  }

  async open(): Promise<void> {
    await this.blockstore.open();
  }

  async close(): Promise<void> {
    await this.blockstore.close();
  }

  async start(_tenant: string, _recordId: string, _dataFormat: string, options?: UploadStoreOptions): Promise<boolean> {
    options?.signal?.throwIfAborted();

    return true;
  }

  async part(tenant: string, recordId: string, index: number, dataStream: Readable, options?: UploadStoreOptions): Promise<UploadPartResult> {
    options?.signal?.throwIfAborted();

    const partitionsForRecord = await abortOr(options?.signal, this.blockstore.partition(tenant));
    const indexesForPartition = await abortOr(options?.signal, partitionsForRecord.partition(recordId));

    const blocksForIndex = await abortOr(options?.signal, indexesForPartition.partition(DATA_PARTITION));
    const blocks = await abortOr(options?.signal, blocksForIndex.partition(index));

    const asyncDataBlocks = importer([{ content: dataStream }], blocks, { cidVersion: 1 });

    // NOTE: the last block contains the root CID as well as info to derive the data size
    let dataDagRoot: ImportResult;
    for await (dataDagRoot of asyncDataBlocks) {
      options?.signal?.throwIfAborted();
    }

    const dataCid = String(dataDagRoot.cid);
    const dataSize = Number(dataDagRoot.unixfs?.fileSize() ?? dataDagRoot.size);

    const rootForIndex = await abortOr(options?.signal, indexesForPartition.partition(ROOT_PARTITION));

    await rootForIndex.put(index, Encoder.stringToBytes(dataCid), options);

    return { dataCid, dataSize };
  }

  async complete(tenant: string, recordId: string, count: number, options?: UploadStoreOptions): Promise<UploadCompleteResult> {
    options?.signal?.throwIfAborted();

    const partitionsForRecord = await abortOr(options?.signal, this.blockstore.partition(tenant));
    const indexesForPartition = await abortOr(options?.signal, partitionsForRecord.partition(recordId));

    const blocksForIndex = await abortOr(options?.signal, indexesForPartition.partition(DATA_PARTITION));
    const rootForIndex = await abortOr(options?.signal, indexesForPartition.partition(ROOT_PARTITION));

    const dataCids: Uint8Array[] = Array(count).fill(new Uint8Array());
    const dataSizes: number[] = Array(count).fill(0);

    for await (const [ indexString, rootDataCidBytes ] of rootForIndex.iterator()) {
      options?.signal?.throwIfAborted();

      const index = Number(indexString);

      const blocks = await abortOr(options?.signal, blocksForIndex.partition(indexString));

      if (index < count) {
        const rootDataCid = Encoder.bytesToString(rootDataCidBytes);
        const dataDagRoot = await abortOr<UnixFSEntry>(options?.signal, exporter(rootDataCid, blocks));

        dataCids[index] = Encoder.stringToBytes(dataDagRoot.cid);
        dataSizes[index] = Number(dataDagRoot.unixfs?.fileSize() ?? dataDagRoot.size);
      } else {
        await abortOr(options?.signal, blocks.clear());
        await rootForIndex.delete(indexString, options);
      }
    }

    return {
      dataCid  : await Cid.computeDagPbCidFromStream(DataStream.fromIterable(dataCids)),
      dataSize : sum(dataSizes)
    };
  }

  async has(tenant: string, recordId: string, options?: UploadStoreOptions): Promise<boolean> {
    options?.signal?.throwIfAborted();

    const partitionsForRecord = await abortOr(options?.signal, this.blockstore.partition(tenant));
    const indexesForPartition = await abortOr(options?.signal, partitionsForRecord.partition(recordId));

    const empty = await abortOr(options?.signal, indexesForPartition.isEmpty());
    return !empty;
  }

  async get(tenant: string, recordId: string, options?: UploadStoreOptions): Promise<Readable | undefined> {
    options?.signal?.throwIfAborted();

    const partitionsForRecord = await abortOr(options?.signal, this.blockstore.partition(tenant));
    const indexesForPartition = await abortOr(options?.signal, partitionsForRecord.partition(recordId));

    const empty = await abortOr(options?.signal, indexesForPartition.isEmpty());
    if (empty) {
      return undefined;
    }

    const blocksForIndex = await abortOr(options?.signal, indexesForPartition.partition(DATA_PARTITION));
    const rootForIndex = await abortOr(options?.signal, indexesForPartition.partition(ROOT_PARTITION));

    return DataStream.fromAsyncIterator((async function*(): AsyncGenerator<Uint8Array> {
      for (let index = 0; true; ++index) {
        const rootDataCidBytes = await rootForIndex.get(index, options);
        if (!rootDataCidBytes) {
          break;
        }

        const blocks = await abortOr(options?.signal, blocksForIndex.partition(index));

        const rootDataCid = Encoder.bytesToString(rootDataCidBytes);
        const dataDagRoot = await abortOr<UnixFSEntry>(options?.signal, exporter(rootDataCid, blocks));

        for await (const block of dataDagRoot.content()) {
          options?.signal?.throwIfAborted();

          yield block;
        }
      }
    })());
  }

  async delete(tenant: string, recordId: string, options?: UploadStoreOptions): Promise<void> {
    options?.signal?.throwIfAborted();

    const recordForTenant = await abortOr(options?.signal, this.blockstore.partition(tenant));
    const indexForRecord = await abortOr(options?.signal, recordForTenant.partition(recordId));

    await abortOr(options?.signal, indexForRecord.clear());
  }

  async clear(): Promise<void> {
    await this.blockstore.clear();
  }

  async dump(): Promise<void> {
    console.group('blockstore');
    await this.blockstore['dump']?.();
    console.groupEnd();
  }
}

type UploadStoreLevelConfig = {
  blockstoreLocation?: string,
  createLevelDatabase?: typeof createLevelDatabase,
};