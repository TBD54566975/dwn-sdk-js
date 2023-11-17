
import type { Filter, QueryOptions } from '../types/query-types.js';
import type { GenericMessage, MessageSort, Pagination } from '../types/message-types.js';
import type { MessageStore, MessageStoreOptions } from '../types/message-store.js';

import * as block from 'multiformats/block';
import * as cbor from '@ipld/dag-cbor';

import { BlockstoreLevel } from './blockstore-level.js';
import { Cid } from '../utils/cid.js';
import { CID } from 'multiformats/cid';
import { createLevelDatabase } from './level-wrapper.js';
import { executeUnlessAborted } from '../utils/abort.js';
import { IndexLevel } from './index-level.js';
import { Message } from '../core/message.js';
import { sha256 } from 'multiformats/hashes/sha2';
import { SortDirection } from '../types/query-types.js';


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

    // creates the query options including sorting and pagination.
    // this adds 1 to the limit if provided, that way we can check to see if there are additional results and provide a return cursor.
    const queryOptions = MessageStoreLevel.getQueryOptions(messageSort, pagination);
    const results = await this.index.query(tenant, filters, queryOptions, options);

    const messages: GenericMessage[] = [];
    for (let i = 0; i < results.length; i++) {
      const messageCid = results[i];
      const message = await this.get(tenant, messageCid, options);
      if (message) { messages.push(message); }
    }

    // checks to see if the returned results are greater than the limit, which would indicate additional results.
    const hasMoreResults = pagination?.limit !== undefined && pagination.limit < results.length;
    let cursor: string | undefined;
    if (hasMoreResults) {
      // if there are additional results, we remove the extra result we queried for.
      messages.splice(-1); // remove last element
      const lastMessage = messages.at(-1); // we choose the last remaining result as a cursor point.
      cursor = await Message.getCid(lastMessage!);
    }

    return { messages, cursor };
  }

  static getQueryOptions(messageSort: MessageSort = {}, pagination: Pagination = {}): QueryOptions {
    let { limit, cursor } = pagination;
    const { dateCreated, datePublished, messageTimestamp } = messageSort;

    let sortDirection = SortDirection.Ascending; // default
    // `keyof MessageSort` = name of all properties of `MessageSort` defaults to messageTimestamp
    let sortProperty: keyof MessageSort = 'messageTimestamp';

    // set the sort property
    if (dateCreated !== undefined) {
      sortProperty = 'dateCreated';
    } else if (datePublished !== undefined) {
      sortProperty = 'datePublished';
    } else if (messageTimestamp !== undefined) {
      sortProperty = 'messageTimestamp';
    }

    if (sortProperty !== undefined && messageSort[sortProperty] !== undefined) {
      sortDirection = messageSort[sortProperty]!;
    }

    // we add one more to the limit to determine whether there are additional results and to return a cursor.
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

    await this.index.put(tenant, messageCidString, indexes, options);
  }


  /**
   * @returns a key, value pair of indexes used for sorting: messageTimestamp, dateCreated, datePublished.
   */
  getSortIndexes(indexes: { [key: string]: string | boolean }):{ [key:string]: unknown } {
    const sortIndexes = { ...indexes };
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

  /**
   * deletes everything in the underlying blockstore and indices.
   */
  async clear(): Promise<void> {
    await this.blockstore.clear();
    await this.index.clear();
  }
}

type MessageStoreLevelConfig = {
  blockstoreLocation?: string,
  indexLocation?: string,
  createLevelDatabase?: typeof createLevelDatabase,
};