
import type { RecordsWriteMessage } from '../index.js';
import type { Filter, GenericMessage, MessageSort, Pagination } from '../types/message-types.js';
import type { MessageStore, MessageStoreOptions } from '../types/message-store.js';

import * as block from 'multiformats/block';
import * as cbor from '@ipld/dag-cbor';

import { ArrayUtility } from '../utils/array.js';
import { BlockstoreLevel } from './blockstore-level.js';
import { CID } from 'multiformats/cid';
import { createLevelDatabase } from './level-wrapper.js';
import { executeUnlessAborted } from '../utils/abort.js';
import { IndexLevel } from './index-level.js';
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
    messageSort?: MessageSort,
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

    const sortedRecords = await this.sortMessages(messages, messageSort);
    return this.paginateRecords(sortedRecords, pagination);
  }

  private async paginateRecords(
    messages: GenericMessage[],
    pagination: Pagination = { }
  ): Promise<GenericMessage[]> {
    const { messageCid, limit = 0 } = pagination;
    if (messageCid === undefined && limit > 0) {
      return messages.slice(0, limit);
    } else if (messageCid === undefined) {
      return messages; // return all
    }

    // linearly searches through the message to locate the message index that contains the message with the given pagination message CID,
    // then construct a page of messages starting from the next message
    // NOTE: there is a potential improvement here: since the messages are sorted,
    // if we fetch the message of the pagination message CID to obtain the value of the sorted property,
    // we could logarithmically go through the messages, reducing the number of times message CID computation is incurred;
    // however this optimization will only be beneficial in practice if the message count is large.
    for (let i = 0; i < messages.length; i++) {
      const testId = await Message.getCid(messages[i]);
      if (testId === messageCid && i + 1 < messages.length) {
        const start = i + 1;
        const end = limit === 0 ? undefined : limit + start;
        return messages.slice(start, end);
      }
    }

    return [];
  }

  /**
   * Compares the chosen property of two messages in lexicographical order.
   * When the value is the same between the two objects, `messageCid` comparison is used to tiebreak.
   *
   * @returns 1 if the chosen property of `messageA` is larger than of `messageB`;
   *         -1 if the chosen property `messageA` is smaller/older than of `messageB`; 0 otherwise
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
  private async sortMessages(
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