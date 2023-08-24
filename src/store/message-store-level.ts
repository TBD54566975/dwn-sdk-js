
import type { RecordsWriteMessage } from '../index.js';
import type { Filter, GenericMessage, MessageSort, Pagination } from '../types/message-types.js';
import type { MessageStore, MessageStoreOptions } from '../types/message-store.js';

import * as block from 'multiformats/block';
import * as cbor from '@ipld/dag-cbor';

import { BlockstoreLevel } from './blockstore-level.js';
import { CID } from 'multiformats/cid';
import { createLevelDatabase } from './level-wrapper.js';
import { executeUnlessAborted } from '../utils/abort.js';
import { IndexLevel } from './index-level.js';
import { lexicographicalCompare } from '../utils/string.js';
import { sha256 } from 'multiformats/hashes/sha2';
import { SortOrder } from '../types/message-types.js';
import { Cid, Message } from '../index.js';


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
    filter: Filter,
    dateSort: MessageSort,
    pagination?: Pagination,
    options?: MessageStoreOptions
  ): Promise<GenericMessage[]> {
    options?.signal?.throwIfAborted();

    const messages: GenericMessage[] = [];

    const resultIds = await this.index.query({ ...filter, tenant }, options);

    for (const id of resultIds) {
      const message = await this.get(tenant, id, options);
      if (message) { messages.push(message); }
    }

    const sortedRecords = this.sortRecords(messages, dateSort);
    return this.paginateRecords(sortedRecords, pagination);
  }

  private async paginateRecords(
    messages: GenericMessage[],
    pagination: Pagination = {},
  ): Promise<GenericMessage[]> {
    const { messageCid: messageId, limit = 0 } = pagination;
    if (messageId === undefined && limit > 0) {
      return messages.slice(0, limit);
    } else if (messageId === undefined) {
      return messages; // return all
    }

    for (let i = 0; i < messages.length; i++) {
      const testId = await Message.getCid(messages[i]);
      if (testId === messageId && i + 1 < messages.length) {
        const start = i + 1;
        const end = limit === 0 ? undefined : limit + start;
        return messages.slice(start, end);
      }
    }
    return [];
  }

  /**
   * This is a temporary naive sort, it will eventually be done within the underlying data store.
   *
   * This sort accepts a generalized MessageSort type which.
   * currently only 3 type of search properties are explicitly used.
   * `dateCreated`, `datePublished`, `messageTimestamp`
   *
   * If sorting is based on date published, records that are not published are filtered out.
   * @param messages - Messages to be sorted if dateSort is present
   * @param dateSort - Sorting scheme
   * @returns Sorted Messages
   */
  private sortRecords(
    messages: GenericMessage[],
    dateSort: MessageSort
  ): GenericMessage[] {
    const { dateCreated, datePublished, messageTimestamp } = dateSort;
    if (dateCreated !== undefined) {
      return (messages as RecordsWriteMessage[]).sort((a,b) => dateCreated === SortOrder.Ascending ?
        lexicographicalCompare(a.descriptor.dateCreated, b.descriptor.dateCreated) :
        lexicographicalCompare(b.descriptor.dateCreated, a.descriptor.dateCreated)
      );
    } else if (datePublished !== undefined) {
      return (messages as RecordsWriteMessage[]).filter(message => message.descriptor.published)
        .sort((a,b) => datePublished === SortOrder.Ascending ?
          lexicographicalCompare(a.descriptor.datePublished!, b.descriptor.datePublished!) :
          lexicographicalCompare(b.descriptor.datePublished!, a.descriptor.datePublished!)
        );
    } else if (messageTimestamp !== undefined) {
      return messages.sort((a,b) => messageTimestamp === SortOrder.Ascending ?
        lexicographicalCompare(a.descriptor.messageTimestamp, b.descriptor.messageTimestamp) :
        lexicographicalCompare(b.descriptor.messageTimestamp, a.descriptor.messageTimestamp)
      );
    }

    // default is messageTimestamp in Ascending order
    return messages.sort((a,b) => lexicographicalCompare(a.descriptor.messageTimestamp, b.descriptor.messageTimestamp));
  }

  async delete(tenant: string, cidString: string, options?: MessageStoreOptions): Promise<void> {
    options?.signal?.throwIfAborted();

    const partition = await executeUnlessAborted(this.blockstore.partition(tenant), options?.signal);

    const cid = CID.parse(cidString);
    await partition.delete(cid, options);
    await this.index.delete(cidString, options);
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
    const indexDocument = {
      ...indexes,
      tenant,
    };
    await this.index.put(messageCidString, indexDocument, options);
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