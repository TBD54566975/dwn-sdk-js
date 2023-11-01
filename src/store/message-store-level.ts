
import type { QueryOptions } from './index-level.js';
import type { Filter, GenericMessage, MessageSort, Pagination } from '../types/message-types.js';
import type { MessageStore, MessageStoreOptions } from '../types/message-store.js';

import * as block from 'multiformats/block';
import * as cbor from '@ipld/dag-cbor';

import { BlockstoreLevel } from './blockstore-level.js';
import { CID } from 'multiformats/cid';
import { executeUnlessAborted } from '../utils/abort.js';
import { IndexLevel } from './index-level.js';
import { sha256 } from 'multiformats/hashes/sha2';
import { SortDirection } from '../types/message-types.js';
import { Cid, Message } from '../index.js';
import { createLevelDatabase, LevelWrapper } from './level-wrapper.js';


/**
 * A simple implementation of {@link MessageStore} that works in both the browser and server-side.
 * Leverages LevelDB under the hood.
 */
export class MessageStoreLevel implements MessageStore {
  config: MessageStoreLevelConfig;

  blockstore: BlockstoreLevel;

  indexDB: LevelWrapper<string>;
  index: IndexLevel<string>;

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

    this.indexDB = new LevelWrapper({
      location            : this.config.indexLocation!,
      createLevelDatabase : this.config.createLevelDatabase,
    });

    this.index = new IndexLevel(this.indexDB);
  }

  async open(): Promise<void> {
    await this.blockstore.open();
    await this.indexDB.open();
  }

  async close(): Promise<void> {
    await this.blockstore.close();
    await this.indexDB.close();
  }

  async get(tenant: string, cidString: string, options?: MessageStoreOptions): Promise<GenericMessage | undefined> {
    options?.signal?.throwIfAborted();

    const partition = await executeUnlessAborted(this.blockstore.partition(tenant), options?.signal);

    const cid = CID.parse(cidString);
    const bytes = await partition.get(cid, options);

    if (!bytes) {
      return undefined;
    }

    const decodedBlock = await executeUnlessAborted(block.decode({ bytes, codec: cbor, hasher: sha256 }), options?.signal);

    const message = decodedBlock.value as GenericMessage;
    return message;
  }

  async query(
    tenant: string,
    filters: Filter[],
    messageSort?: MessageSort,
    pagination?: Pagination,
    options?: MessageStoreOptions
  ): Promise<{ messages: GenericMessage[], cursor?: string }> {
    options?.signal?.throwIfAborted();

    const queryOptions = MessageStoreLevel.getQueryOptions(messageSort, pagination);
    // note: injecting tenant into filters to allow querying with an "empty" filter.
    // if there are no other filters present it will return all the messages the tenant.
    const resultIds = await this.index.query(tenant, filters.map(filter => ({ ...filter, tenant })), queryOptions, options);

    const messages: GenericMessage[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < resultIds.length; i++) {
      const id = resultIds[i];
      const message = await this.get(tenant, id, options);
      if (message) { messages.push(message); }
    }
    const hasMoreResults = pagination?.limit !== undefined && pagination.limit < resultIds.length;
    if (hasMoreResults) {
      messages.splice(-1); // remove last element
      const lastMessage = messages.at(-1);
      cursor = await Message.getCid(lastMessage!);
    }

    return { messages, cursor };
  }

  static getQueryOptions(messageSort: MessageSort = {}, pagination: Pagination = {}): QueryOptions {
    let { limit, cursor } = pagination;
    const { dateCreated, datePublished, messageTimestamp } = messageSort;

    let sortDirection = SortDirection.Ascending; // default
    let sortProperty: keyof MessageSort | undefined; // `keyof MessageSort` = name of all properties of `MessageSort`

    if (dateCreated !== undefined) {
      sortProperty = 'dateCreated';
    } else if (datePublished !== undefined) {
      sortProperty = 'datePublished';
    } else if (messageTimestamp !== undefined) {
      sortProperty = 'messageTimestamp';
    }

    if (sortProperty !== undefined && messageSort[sortProperty] !== undefined) {
      sortDirection = messageSort[sortProperty]!;
    } else {
      sortProperty = 'messageTimestamp';
    }

    // we add one more to the limit to return a pagination cursor
    if (limit && limit > 0) {
      limit = limit + 1;
    }

    return { sortDirection, sortProperty, limit, cursor };
  }

  async delete(tenant: string, cidString: string, options?: MessageStoreOptions): Promise<void> {
    options?.signal?.throwIfAborted();

    const partition = await executeUnlessAborted(this.blockstore.partition(tenant), options?.signal);

    const cid = CID.parse(cidString);
    await partition.delete(cid, options);
    await this.index.delete(tenant, cidString, options);
  }

  getSortIndexes(indexes: { [key: string]: string | boolean }):{ [key:string]: string } {
    const sortIndexes: { [key:string]: string } = {};
    if (indexes.messageTimestamp !== undefined
      && typeof indexes.messageTimestamp === 'string') {
      sortIndexes.messageTimestamp = indexes.messageTimestamp;
    }

    if (indexes.dateCreated !== undefined
      && typeof indexes.dateCreated === 'string') {
      sortIndexes.dateCreated = indexes.dateCreated;
    }

    if (indexes.datePublished !== undefined
      && typeof indexes.datePublished === 'string') {
      sortIndexes.datePublished = indexes.datePublished;
    }

    return sortIndexes;
  }

  async put(
    tenant: string,
    message: GenericMessage,
    indexes: { [key: string]: string | boolean },
    options?: MessageStoreOptions
  ): Promise<void> {
    options?.signal?.throwIfAborted();

    const sortIndexes = this.getSortIndexes(indexes);
    if (sortIndexes.messageTimestamp === undefined) {
      throw new Error('must include messageTimestamp index');
    }

    const partition = await executeUnlessAborted(this.blockstore.partition(tenant), options?.signal);

    const encodedMessageBlock = await executeUnlessAborted(block.encode({ value: message, codec: cbor, hasher: sha256 }), options?.signal);

    // MessageStore data may contain `encodedData` which is not taken into account when calculating the blockCID as it is optional data.
    const messageCid = Cid.parseCid(await Message.getCid(message));
    await partition.put(messageCid, encodedMessageBlock.bytes, options);

    const messageCidString = messageCid.toString();

    // note: leaving the additional tenant indexing to allow for querying with an "empty" filter.
    // when querying, we also inject a filter for the specific tenant.
    // if there are no other filters present it will return all the messages for that tenant.
    const indexDocument = {
      ...indexes,
      tenant,
    };
    await this.index.put(tenant, messageCidString, messageCidString, indexDocument, sortIndexes, options);
  }

  /**
   * deletes everything in the underlying blockstore and indices.
   */
  async clear(): Promise<void> {
    await this.blockstore.clear();
    await this.indexDB.clear();
  }
}

type MessageStoreLevelConfig = {
  blockstoreLocation?: string,
  indexLocation?: string,
  createLevelDatabase?: typeof createLevelDatabase,
};