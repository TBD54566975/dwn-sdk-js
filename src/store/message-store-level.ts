import type { MessageStore } from './message-store.js';
import type { BaseMessage, DataReferencingMessage } from '../core/types.js';

import * as block from 'multiformats/block';
import * as cbor from '@ipld/dag-cbor';
import isPlainObject from 'lodash/isPlainObject.js';
import searchIndex from 'search-index';

import { BlockstoreLevel } from './blockstore-level.js';
import { CID } from 'multiformats/cid';
import { DataStoreLevel } from './data-store-level.js';
import { Encoder } from '../utils/encoder.js';
import { RangeCriterion } from '../interfaces/records/types.js';
import { Readable } from 'readable-stream';
import { sha256 } from 'multiformats/hashes/sha2';

import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

/**
 * A simple implementation of {@link MessageStore} that works in both the browser and server-side.
 * Leverages LevelDB under the hood.
 */
export class MessageStoreLevel implements MessageStore {
  config: MessageStoreLevelConfig;
  db: BlockstoreLevel;
  // levelDB doesn't natively provide the querying capabilities needed for DWN,
  // to accommodate, we're leveraging a level-backed inverted index.
  index: Awaited<ReturnType<typeof searchIndex>>; // type `SearchIndex` is not exported. So we construct it indirectly from function return type

  dataStore: DataStoreLevel;

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
      ...config
    };

    this.db = new BlockstoreLevel(this.config.blockstoreLocation);
    this.dataStore = new DataStoreLevel(this.db);
  }

  async open(): Promise<void> {
    await this.dataStore.open();

    if (!this.db) {
      this.db = new BlockstoreLevel(this.config.blockstoreLocation);
    }

    await this.db.open();

    // calling `searchIndex()` twice without closing its DB causes the process to hang (ie. calling this method consecutively),
    // so check to see if the index has already been "opened" before opening it again.
    if (!this.index) {
      this.index = await searchIndex({ name: this.config.indexLocation });
    }
  }

  async close(): Promise<void> {
    await this.dataStore.close();

    await this.db.close();
    await this.index.INDEX.STORE.close(); // MUST close index-search DB, else `searchIndex()` triggered in a different instance will hang indefinitely
  }

  async get(cidString: string): Promise<BaseMessage> {
    const cid = CID.parse(cidString);
    const bytes = await this.db.get(cid);

    if (!bytes) {
      return;
    }

    const decodedBlock = await block.decode({ bytes, codec: cbor, hasher: sha256 });

    const messageJson = decodedBlock.value as BaseMessage;

    if (!messageJson.descriptor['dataCid']) {
      return messageJson;
    }

    // TODO: #219 (https://github.com/TBD54566975/dwn-sdk-js/issues/219)
    // temporary placeholder for keeping status-quo of returning data in `encodedData`
    // once #219 is implemented, `encodedData` will likely not exist directly as part of the returned message here
    const dataReferencingMessage = decodedBlock.value as DataReferencingMessage;
    const dataBytes = await this.dataStore.get('not used yet', 'not used yet', dataReferencingMessage.descriptor.dataCid);

    dataReferencingMessage.encodedData = Encoder.bytesToBase64Url(dataBytes);

    return messageJson;
  }

  async query(exactCriteria: { [key: string]: string }, rangeCriteria?: { [key: string]: RangeCriterion }): Promise<BaseMessage[]> {
    const messages: BaseMessage[] = [];

    // parse criteria into a query that is compatible with the indexing DB (search-index) we're using
    const exactTerms = MessageStoreLevel.buildExactQueryTerms(exactCriteria);
    const rangeTerms = MessageStoreLevel.buildRangeQueryTerms(rangeCriteria);

    const { RESULT: indexResults } = await this.index.QUERY({ AND: [...exactTerms, ...rangeTerms] });

    for (const result of indexResults) {
      const message = await this.get(result._id);
      messages.push(message);
    }

    return messages;
  }

  async delete(cidString: string): Promise<void> {
    // TODO: Implement data deletion in Records - https://github.com/TBD54566975/dwn-sdk-js/issues/84
    const cid = CID.parse(cidString);
    await this.db.delete(cid);
    await this.index.DELETE(cidString);

    return;
  }

  async put(message: BaseMessage, indexes: { [key: string]: string }, dataStream?: Readable): Promise<void> {
    const encodedMessageBlock = await block.encode({ value: message, codec: cbor, hasher: sha256 });

    await this.db.put(encodedMessageBlock.cid, encodedMessageBlock.bytes);

    // if `dataCid` is given, it means there is corresponding data associated with this message
    // but NOTE: it is possible that a data stream is not given in such case, for instance,
    // a subsequent RecordsWrite that changes the `published` property, but the data hasn't changed,
    // in this case requiring re-uploading of the data is extremely inefficient so we take care allow omission of data stream
    if (message.descriptor.dataCid !== undefined) {
      if (dataStream === undefined) {
        // the message implies that the data is already in the DB, so we check to make sure the data already exist
        // TODO: #218 - Use tenant + record scoped IDs - https://github.com/TBD54566975/dwn-sdk-js/issues/218
        const dataCid = CID.parse(message.descriptor.dataCid);
        const rootBlockByte = await this.db.get(dataCid);

        if (rootBlockByte === undefined) {
          throw new DwnError(
            DwnErrorCode.MessageStoreDataNotFound,
            `data with dataCid ${message.descriptor.dataCid} not found in store`
          );
        }
      } else {
        const actualDataCid = await this.dataStore.put('not used yet', 'not used yet', dataStream );

        // MUST verify that the CID of the actual data matches with the given `dataCid`
        // if data CID is wrong, delete the data we just stored
        if (message.descriptor.dataCid !== actualDataCid) {
          // there is an opportunity to improve here: handle the edge cae of if the delete fails...
          await this.dataStore.delete('not used yet', 'not used yet', actualDataCid);
          throw new DwnError(
            DwnErrorCode.MessageStoreDataCidMismatch,
            `actual data CID ${actualDataCid} does not match dataCid in descriptor: ${message.descriptor.dataCid}`
          );
        }
      }
    }

    // TODO: #218 - Use tenant + record scoped IDs - https://github.com/TBD54566975/dwn-sdk-js/issues/218
    const encodedMessageBlockCid = encodedMessageBlock.cid.toString();
    const indexDocument = {
      _id: encodedMessageBlockCid,
      ...indexes
    };

    // tokenSplitRegex is used to tokenize values. By default, only letters and digits are indexed,
    // overriding to include all characters, examples why we need to include more than just letters and digits:
    // 'did:example:alice'                    - ':'
    // '337970c4-52e0-4bd7-b606-bfc1d6fe2350' - '-'
    // 'application/json'                     - '/'
    await this.index.PUT([indexDocument], { tokenSplitRegex: /.+/ });
  }

  /**
   * deletes everything in the underlying datastore and indices.
   */
  async clear(): Promise<void> {
    await this.dataStore.clear();
    await this.db.clear();
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
};