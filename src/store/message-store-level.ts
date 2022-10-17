import type { BaseMessage, DataReferencingMessage } from '../core/types';
import type { MessageStore } from './message-store';
import * as encoder from '../utils/encoder';
import { BlockstoreLevel } from './blockstore-level';
import { CID } from 'multiformats/cid';
import { exporter } from 'ipfs-unixfs-exporter';
import { importer } from 'ipfs-unixfs-importer';
import { sha256 } from 'multiformats/hashes/sha2';

import * as cbor from '@ipld/dag-cbor';
import * as block from 'multiformats/block';

import _ from 'lodash';
import searchIndex from 'search-index';

/**
 * A simple implementation of {@link MessageStore} that works in both the browser and server-side.
 * Leverages LevelDB under the hood.
 */
export class MessageStoreLevel implements MessageStore {
  config: MessageStoreLevelConfig;
  db: BlockstoreLevel;
  // levelDB doesn't natively provide the querying capabilities needed for DWN. To accommodate, we're leveraging
  // a level-backed inverted index
  // TODO: search-index lib does not import type `SearchIndex`. find a workaround, Issue #48, https://github.com/TBD54566975/dwn-sdk-js/issues/48
  index;

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
  }

  async open(): Promise<void> {
    if (!this.db) {
      this.db = new BlockstoreLevel(this.config.blockstoreLocation);
    }

    await this.db.open();

    // TODO: look into using the same level we're using for blockstore, Issue #49 https://github.com/TBD54566975/dwn-sdk-js/issues/49
    // calling `searchIndex()` twice without closing its DB causes the process to hang (ie. calling this method consecutively),
    // so check to see if the index has already been "opened" before opening it again.
    if (!this.index) {
      this.index = await searchIndex({ name: this.config.indexLocation });
    }
  }

  async close(): Promise<void> {
    await this.db.close();
    await this.index.INDEX.STORE.close(); // MUST close index-search DB, else `searchIndex()` triggered in a different instance will hang indefinitely
  }

  async get(cid: CID): Promise<BaseMessage> {
    const bytes = await this.db.get(cid);

    if (!bytes) {
      return;
    }

    const decodedBlock = await block.decode({ bytes, codec: cbor, hasher: sha256 });

    const messageJson = decodedBlock.value as BaseMessage;

    if (!messageJson.descriptor['dataCid']) {
      return messageJson;
    }

    // data is chunked into dag-pb unixfs blocks. re-inflate the chunks.
    const dataReferencingMessage = decodedBlock.value as DataReferencingMessage;
    const dataCid = CID.parse(dataReferencingMessage.descriptor.dataCid);

    const dataDagRoot = await exporter(dataCid, this.db);
    const dataBytes = new Uint8Array(dataDagRoot.size);
    let offset = 0;

    for await (const chunk of dataDagRoot.content()) {
      dataBytes.set(chunk, offset);
      offset += chunk.length;
    }

    dataReferencingMessage.encodedData = encoder.bytesToBase64Url(dataBytes);

    return messageJson;
  }

  async query(includeCriteria: any, excludeCriteria: any = {}): Promise<BaseMessage[]> {
    const messages: BaseMessage[] = [];

    // parse query into a query that is compatible with the index we're using
    const includeQueryTerms = MessageStoreLevel.buildIndexQueryTerms(includeCriteria);
    const excludeQueryTerms = MessageStoreLevel.buildIndexQueryTerms(excludeCriteria);
    const finalQuery = {
      NOT: {
        INCLUDE : { AND: includeQueryTerms },
        EXCLUDE : { AND: excludeQueryTerms }
      }
    };

    const { RESULT: indexResults } = await this.index.QUERY(finalQuery);

    for (const result of indexResults) {
      const cid = CID.parse(result._id);
      const message = await this.get(cid);

      messages.push(message);
    }

    return messages;
  }


  async delete(cid: CID): Promise<void> {
    // TODO: Implement data deletion in Collections - https://github.com/TBD54566975/dwn-sdk-js/issues/84
    await this.db.delete(cid);
    await this.index.DELETE(cid.toString());

    return;
  }

  async put(messageJson: BaseMessage, author: string): Promise<void> {

    // delete `encodedData` if it exists so `messageJson` is stored without it, `encodedData` will be decoded, chunked and stored separately below
    let encodedData = undefined;
    if (messageJson['encodedData'] !== undefined) {
      const messageJsonWithEncodedData = messageJson as unknown as DataReferencingMessage;
      encodedData = messageJsonWithEncodedData.encodedData;

      delete messageJsonWithEncodedData.encodedData;
    }

    const encodedBlock = await block.encode({ value: messageJson, codec: cbor, hasher: sha256 });

    await this.db.put(encodedBlock.cid, encodedBlock.bytes);

    // if `encodedData` is present we'll decode it then chunk it and store it as unix-fs dag-pb encoded
    if (encodedData) {
      const content = encoder.base64urlToBytes(encodedData);
      const chunk = importer([{ content }], this.db, { cidVersion: 1 });

      // for some reason no-unused-vars doesn't work in for loops. it's not entirely surprising because
      // it does seem a bit strange to iterate over something you never end up using but in this case
      // we really don't have to access the result of `chunk` because it's just outputting every unix-fs
      // entry that's getting written to the blockstore. the last entry contains the root cid
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of chunk);
    }

    const indexDocument = {
      author, // add author to the index
      ...messageJson.descriptor,
      _id: encodedBlock.cid.toString()
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
    await this.db.clear();
    await this.index.FLUSH();
  }

  /**
   * recursively parses a query object into a list of flattened terms that can be used to query the search
   * index
   * @example
   * buildIndexQueryTerms({
   *    ability : {
   *      method : 'CollectionsQuery',
   *      schema : 'https://schema.org/MusicPlaylist'
   *    }
   * })
   * // returns
   * [
        { FIELD: ['ability.method'], VALUE: 'CollectionsQuery' },
        { FIELD: ['ability.schema'], VALUE: 'https://schema.org/MusicPlaylist' }
      ]
   * @param query - the query to parse
   * @param terms - internally used to collect terms
   * @param prefix - internally used to pass parent properties into recursive calls
   * @returns the list of terms
   */
  private static buildIndexQueryTerms(
    query: any,
    terms: SearchIndexTerm[] =[],
    prefix: string = ''
  ): SearchIndexTerm[] {
    for (const property in query) {
      const val = query[property];

      if (_.isPlainObject(val)) {
        MessageStoreLevel.buildIndexQueryTerms(val, terms, `${prefix}${property}.`);
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
}

type SearchIndexTerm = {
  FIELD: string[];
  VALUE: any;
};

type MessageStoreLevelConfig = {
  blockstoreLocation?: string,
  indexLocation?: string,
};