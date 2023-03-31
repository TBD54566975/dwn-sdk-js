import type { BaseMessage, Filter } from '../core/types.js';
import type { MessageStore, MessageStoreOptions } from './message-store.js';

import * as block from 'multiformats/block';
import * as cbor from '@ipld/dag-cbor';

import { abortOr } from '../utils/abort.js';
import { BlockstoreLevel } from './blockstore-level.js';
import { CID } from 'multiformats/cid';
import { createLevelDatabase } from './level-wrapper.js';
import { IndexLevel } from './index-level.js';
import { sha256 } from 'multiformats/hashes/sha2';

/**
 * A simple implementation of {@link MessageStore} that works in both the browser and server-side.
 * Leverages LevelDB under the hood.
 */
export class MessageStoreLevel implements MessageStore {
  config: MessageStoreLevelConfig;

  blockstore: BlockstoreLevel;

  index: IndexLevel;

  /**
   * @param {MessageStoreLevelConfig} config
   * @param {string} config.blockstoreLocation - must be a directory path (relative or absolute) where
   *  LevelDB will store its files, or in browsers, the name of the
   * {@link https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase IDBDatabase} to be opened.
   * @param {string} config.indexLocation - same as config.blockstoreLocation
   */
  constructor(config: MessageStoreLevelConfig = {}) {
    this.config = {
      blockstoreLocation : 'MESSAGESTORE',
      indexLocation      : 'INDEX',
      createLevelDatabase,
      ...config
    };

    this.blockstore = new BlockstoreLevel({
      location            : this.config.blockstoreLocation!,
      createLevelDatabase : this.config.createLevelDatabase,
    });

    this.index = new IndexLevel({
      location            : this.config.indexLocation!,
      createLevelDatabase : this.config.createLevelDatabase,
    });
  }

  async open(): Promise<void> {
    await this.blockstore.open();
    await this.index.open();
  }

  async close(): Promise<void> {
    await this.blockstore.close();
    await this.index.close();
  }

  async get(tenant: string, cidString: string, options?: MessageStoreOptions): Promise<BaseMessage | undefined> {
    options?.signal?.throwIfAborted();

    const partition = await abortOr(options?.signal, this.blockstore.partition(tenant));

    const cid = CID.parse(cidString);
    const bytes = await partition.get(cid, options);

    if (!bytes) {
      return undefined;
    }

    const decodedBlock = await abortOr(options?.signal, block.decode({ bytes, codec: cbor, hasher: sha256 }));

    const messageJson = decodedBlock.value as BaseMessage;
    return messageJson;
  }

  async query(tenant: string, filter: Filter, options?: MessageStoreOptions): Promise<BaseMessage[]> {
    options?.signal?.throwIfAborted();

    const messages: BaseMessage[] = [];

    const resultIds = await this.index.query({ ...filter, tenant }, options);

    for (const id of resultIds) {
      const message = await this.get(tenant, id, options);
      if (message) { messages.push(message); }
    }

    return messages;
  }

  async delete(tenant: string, cidString: string, options?: MessageStoreOptions): Promise<void> {
    options?.signal?.throwIfAborted();

    const partition = await abortOr(options?.signal, this.blockstore.partition(tenant));

    const cid = CID.parse(cidString);
    await partition.delete(cid, options);
    await this.index.delete(cidString, options);
  }

  async put(
    tenant: string,
    message: BaseMessage,
    indexes: { [key: string]: string },
    options?: MessageStoreOptions
  ): Promise<void> {
    options?.signal?.throwIfAborted();

    const partition = await abortOr(options?.signal, this.blockstore.partition(tenant));

    const encodedMessageBlock = await abortOr(options?.signal, block.encode({ value: message, codec: cbor, hasher: sha256 }));

    await partition.put(encodedMessageBlock.cid, encodedMessageBlock.bytes, options);

    const encodedMessageBlockCid = encodedMessageBlock.cid.toString();
    const indexDocument = {
      ...indexes,
      tenant,
    };
    await this.index.put(encodedMessageBlockCid, indexDocument, options);
  }

  /**
   * deletes everything in the underlying blockstore and indices.
   */
  async clear(): Promise<void> {
    await this.blockstore.clear();
    await this.index.clear();
  }

  async dump(): Promise<void> {
    console.group('blockstore');
    await this.blockstore['dump']?.();
    console.groupEnd();

    console.group('index');
    await this.index['dump']?.();
    console.groupEnd();
  }
}

type MessageStoreLevelConfig = {
  blockstoreLocation?: string,
  indexLocation?: string,
  createLevelDatabase?: typeof createLevelDatabase,
};