import type { BaseMessage } from '../core/types.js';
import type { MessageStore, Options } from './message-store.js';

import * as block from 'multiformats/block';
import * as cbor from '@ipld/dag-cbor';
import isPlainObject from 'lodash/isPlainObject.js';
import searchIndex from 'search-index';

import { abortOr } from '../utils/abort.js';
import { BlockstoreLevel } from './blockstore-level.js';
import { CID } from 'multiformats/cid';
import { createLevelDatabase } from './create-level.js';
import { RangeCriterion } from '../interfaces/records/types.js';
import { sha256 } from 'multiformats/hashes/sha2';

/**
 * A simple implementation of {@link MessageStore} that works in both the browser and server-side.
 * Leverages LevelDB under the hood.
 */
export class MessageStoreLevel implements MessageStore {
  config: MessageStoreLevelConfig;

  blockstore: BlockstoreLevel;

  // levelDB doesn't natively provide the querying capabilities needed for DWN,
  // to accommodate, we're leveraging a level-backed inverted index.
  index: Awaited<ReturnType<typeof searchIndex>>; // type `SearchIndex` is not exported. So we construct it indirectly from function return type

  /**
   * @param {MessageStoreLevelConfig} config
   * @param {string} config.blockstoreLocation - must be a directory path (relative or absolute) where
   *  LevelDB will store its files, or in browsers, the name of the
   * {@link https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase IDBDatabase} to be opened.
   * @param {string} config.indexLocation - same as config.blockstoreLocation
   */
  constructor(config: MessageStoreLevelConfig = {}) {
    this.config = {
      blockstoreLocation : 'BLOCKSTORE',
      indexLocation      : 'INDEX',
      createLevelDatabase,
      ...config
    };

    this.blockstore = new BlockstoreLevel(this.config.blockstoreLocation, {
      createLevelDatabase: this.config.createLevelDatabase,
    });
  }

  async open(): Promise<void> {
    await this.blockstore.open();

    // calling `searchIndex()` twice without closing its DB causes the process to hang (ie. calling this method consecutively),
    // so check to see if the index has already been "opened" before opening it again.
    if (!this.index) {
      this.index = await searchIndex({ name: this.config.indexLocation });
    }
  }

  async close(): Promise<void> {
    await this.blockstore.close();
    await this.index.INDEX.STORE.close(); // MUST close index-search DB, else `searchIndex()` triggered in a different instance will hang indefinitely
  }

  async get(tenant: string, cidString: string, options?: Options): Promise<BaseMessage | undefined> {
    options?.signal?.throwIfAborted();

    const partition = this.blockstore.partition(tenant);

    const cid = CID.parse(cidString);
    const bytes = await partition.get(cid, options);

    if (!bytes) {
      return undefined;
    }

    const decodedBlock = await abortOr(options?.signal, block.decode({ bytes, codec: cbor, hasher: sha256 }));

    const messageJson = decodedBlock.value as BaseMessage;
    return messageJson;
  }

  async query(
    tenant: string,
    exactCriteria: { [key: string]: string },
    rangeCriteria?: { [key: string]: RangeCriterion },
    options?: Options
  ): Promise<BaseMessage[]> {
    options?.signal?.throwIfAborted();

    const messages: BaseMessage[] = [];

    // parse criteria into a query that is compatible with the indexing DB (search-index) we're using
    const exactTerms = MessageStoreLevel.buildExactQueryTerms({ ...exactCriteria, tenant });
    const rangeTerms = MessageStoreLevel.buildRangeQueryTerms(rangeCriteria);

    const { RESULT: indexResults } = await abortOr(options?.signal, this.index.QUERY({ AND: [...exactTerms, ...rangeTerms] }));

    for (const result of indexResults) {
      const message = await this.get(tenant, result._id, options);
      messages.push(message);
    }

    return messages;
  }

  async delete(tenant: string, cidString: string, options?: Options): Promise<void> {
    options?.signal?.throwIfAborted();

    const partition = this.blockstore.partition(tenant);

    // TODO: Implement data deletion in Records - https://github.com/TBD54566975/dwn-sdk-js/issues/84
    const cid = CID.parse(cidString);
    await partition.delete(cid, options);
    await abortOr(options?.signal, this.index.DELETE(cidString));

    return;
  }

  async put(
    tenant: string,
    message: BaseMessage,
    indexes: { [key: string]: string },
    options?: Options
  ): Promise<void> {
    options?.signal?.throwIfAborted();

    const partition = this.blockstore.partition(tenant);

    const encodedMessageBlock = await abortOr(options?.signal, block.encode({ value: message, codec: cbor, hasher: sha256 }));

    await partition.put(encodedMessageBlock.cid, encodedMessageBlock.bytes, options);

    // TODO: #218 - Use tenant + record scoped IDs - https://github.com/TBD54566975/dwn-sdk-js/issues/218
    const encodedMessageBlockCid = encodedMessageBlock.cid.toString();
    const indexDocument = {
      ...indexes,
      tenant,
      _id: encodedMessageBlockCid
    };

    // tokenSplitRegex is used to tokenize values. By default, only letters and digits are indexed,
    // overriding to include all characters, examples why we need to include more than just letters and digits:
    // 'did:example:alice'                    - ':'
    // '337970c4-52e0-4bd7-b606-bfc1d6fe2350' - '-'
    // 'application/json'                     - '/'
    await abortOr(options?.signal, this.index.PUT([indexDocument], { tokenSplitRegex: /.+/ }));
  }

  /**
   * deletes everything in the underlying datastore and indices.
   */
  async clear(): Promise<void> {
    await this.blockstore.clear();
    await this.index.FLUSH();
  }

  /**
   * recursively parses a query object into a list of flattened terms that can be used to query the search
   * index
   * @example
   * buildExactQueryTerms({
   *    ability : {
   *      method : 'RecordsQuery',
   *      schema : 'https://schema.org/MusicPlaylist'
   *    }
   * })
   * // returns
   * [
        { FIELD: ['ability.method'], VALUE: 'RecordsQuery' },
        { FIELD: ['ability.schema'], VALUE: 'https://schema.org/MusicPlaylist' }
      ]
   * @param query - the query to parse
   * @param terms - internally used to collect terms
   * @param prefix - internally used to pass parent properties into recursive calls
   * @returns the list of terms
   */
  private static buildExactQueryTerms(
    query: any,
    terms: SearchIndexTerm[] =[],
    prefix: string = ''
  ): SearchIndexTerm[] {
    for (const property in query) {
      const val = query[property];

      if (isPlainObject(val)) {
        MessageStoreLevel.buildExactQueryTerms(val, terms, `${prefix}${property}.`);
      } else {
        // NOTE: using object-based expressions because we need to support filters against non-string properties
        const term = {
          FIELD : [`${prefix}${property}`],
          VALUE : val
        };
        terms.push(term);
      }
    }

    return terms;
  }

  /**
   * Builds a list of `search-index` range terms given a list of range criteria.
   * @example
   * // example output
   * [
   *   {
   *     FIELD: ['dateCreated'],
   *     VALUE: {
   *       GTE: '2023-02-07T10:20:30.123456',
   *       LTE: '2023-02-08T10:20:30.123456'
   *     }
   *   },
   * ]
   */
  private static buildRangeQueryTerms(
    rangeCriteria: { [key: string]: RangeCriterion} = { }
  ): SearchIndexTerm[] {
    const terms = [];

    for (const rangeFilterName in rangeCriteria) {
      const rangeFilter = rangeCriteria[rangeFilterName];

      const term: RangeSearchIndexTerm = {
        FIELD : [`${rangeFilterName}`],
        VALUE : { }
      };

      if (rangeFilter.from !== undefined) {
        term.VALUE.GTE = rangeFilter.from;
      }

      if (rangeFilter.to !== undefined) {
        term.VALUE.LTE = rangeFilter.to;
      }

      terms.push(term);
    }

    return terms;
  }
}

type SearchIndexTerm = {
  FIELD: string[];
  VALUE: any;
};

type RangeSearchIndexTerm = {
  FIELD: string[],
  VALUE: {
    GTE?: string,
    LTE?: string
  }
};

type MessageStoreLevelConfig = {
  blockstoreLocation?: string,
  indexLocation?: string,
  createLevelDatabase?: typeof createLevelDatabase,
};