
import type { RecordsWriteMessage } from '../types/records-types.js';
import type { Filter, GenericMessage, MessageSort, Pagination } from '../types/message-types.js';
import type { MessageStore, MessageStoreOptions } from '../types/message-store.js';

import * as block from 'multiformats/block';
import * as cbor from '@ipld/dag-cbor';

import { ArrayUtility } from '../utils/array.js';
import { BlockstoreLevel } from './blockstore-level.js';
import { Cid } from '../utils/cid.js';
import { CID } from 'multiformats/cid';
import { createLevelDatabase } from './level-wrapper.js';
import { executeUnlessAborted } from '../utils/abort.js';
import { IndexLevel } from './index-level.js';
import { Message } from '../core/message.js';
import { sha256 } from 'multiformats/hashes/sha2';
import { SortOrder } from '../types/message-types.js';


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

    const messages: GenericMessage[] = [];
    // note: injecting tenant into filters to allow querying with an "empty" filter.
    // if there are no other filters present it will return all the messages the tenant.
    const resultIds = await this.index.query(tenant, filters.map(f => ({ ...f, tenant })), options);

    // as an optimization for large data sets, we are finding the message object which matches the cursor here.
    // we can use this within the pagination function after sorting to determine the starting point of the array in a more efficient way.
    let paginationMessage: GenericMessage | undefined;
    for (const id of resultIds) {
      const message = await this.get(tenant, id, options);
      if (message) { messages.push(message); }
      if (pagination?.cursor && pagination.cursor === id) {
        paginationMessage = message;
      }
    }

    if (pagination?.cursor !== undefined && paginationMessage === undefined) {
      return { messages: [] }; //if paginationMessage is not found, do not return any results
    }

    const sortedRecords = await MessageStoreLevel.sortMessages(messages, messageSort);
    return this.paginateMessages(sortedRecords, paginationMessage, pagination);
  }

  private async paginateMessages(
    messages: GenericMessage[],
    paginationMessage?: GenericMessage,
    pagination: Pagination = { }
  ): Promise<{ messages: GenericMessage[], cursor?: string } > {
    const { limit } = pagination;
    if (paginationMessage === undefined && limit === undefined) {
      return { messages }; // return all without pagination pointer.
    }

    // we are passing the pagination message object for an easier lookup
    // since we know this object exists within the array if passed, we can assume that it will always have a value greater than -1
    // TODO: #506 - Improve performance by modifying filters based on the pagination cursor (https://github.com/TBD54566975/dwn-sdk-js/issues/506)
    const cursorIndex = paginationMessage ? messages.indexOf(paginationMessage) : undefined;

    // the first element of the returned results is always the message immediately following the cursor.
    const start = cursorIndex === undefined ? 0 : cursorIndex + 1;
    const end = limit === undefined ? undefined : start + limit;
    const results = messages.slice(start, end);

    // we only return a cursor cursor if there are more results
    const hasMoreResults = end !== undefined && end < messages.length;
    let cursor: string|undefined;
    if (hasMoreResults) {
      // we extract the cid of the last message in the result set.
      const lastMessage = results.at(-1);
      cursor = await Message.getCid(lastMessage!);
    }

    return { messages: results, cursor };
  }

  /**
   * Compares the chosen property of two messages in lexicographical order.
   * When the value is the same between the two objects, `messageCid` comparison is used to tiebreak.
   * tiebreaker always compares messageA to messageB
   *
   * @returns if SortOrder is Ascending:
   *            1 if the chosen property of `messageA` is larger than of `messageB`;
   *           -1 if the chosen property `messageA` is smaller/older than of `messageB`;
   *            0 otherwise
   *          if SortOrder is Descending:
   *            1 if the chosen property of `messageB` is larger than of `messageA`;
   *           -1 if the chosen property `messageB` is smaller/older than of `messageA`;
   *            0 otherwise
   */
  static async lexicographicalCompare(
    messageA: GenericMessage,
    messageB: GenericMessage,
    comparedPropertyName: string,
    sortOrder: SortOrder): Promise<number>
  {
    const a = (messageA.descriptor as any)[comparedPropertyName];
    const b = (messageB.descriptor as any)[comparedPropertyName];

    if (sortOrder === SortOrder.Ascending) {
      if (a > b) {
        return 1;
      } else if (a < b) {
        return -1;
      }
    } else {
      // descending order
      if (b > a) {
        return 1;
      } else if (b < a) {
        return -1;
      }
    }

    // if we reach here it means the compared properties have the same values, we need to fall back to compare the `messageCid` instead
    return await Message.compareCid(messageA, messageB);
  }

  /**
   * This is a temporary naive sort, it will eventually be done within the underlying data store.
   *
   * If sorting is based on date published, records that are not published are filtered out.
   * @param messages - Messages to be sorted if dateSort is present
   * @param sort - Sorting scheme
   * @returns Sorted Messages
   */
  public static async sortMessages(
    messages: GenericMessage[],
    messageSort: MessageSort = { }
  ): Promise<GenericMessage[]> {
    const { dateCreated, datePublished, messageTimestamp } = messageSort;

    let sortOrder = SortOrder.Ascending; // default
    let messagesToSort = messages; // default
    let propertyToCompare: keyof MessageSort | undefined; // `keyof MessageSort` = name of all properties of `MessageSort`

    if (dateCreated !== undefined) {
      propertyToCompare = 'dateCreated';
    } else if (datePublished !== undefined) {
      propertyToCompare = 'datePublished';
      messagesToSort = (messages as RecordsWriteMessage[]).filter(message => message.descriptor.published);
    } else if (messageTimestamp !== undefined) {
      propertyToCompare = 'messageTimestamp';
    }

    if (propertyToCompare !== undefined) {
      sortOrder = messageSort[propertyToCompare]!;
    } else {
      propertyToCompare = 'messageTimestamp';
    }

    const asyncComparer = (a: GenericMessage, b: GenericMessage): Promise<number> => {
      return MessageStoreLevel.lexicographicalCompare(a, b, propertyToCompare!, sortOrder);
    };

    // NOTE: we needed to implement our own asynchronous sort method because Array.sort() does not take an async comparer
    return await ArrayUtility.asyncSort(messagesToSort, asyncComparer);
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
    await this.index.put(tenant, messageCidString, indexDocument, options);
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