import { BlockstoreLevel } from './blockstore-level';
import { CID } from 'multiformats/cid';
import { importer } from 'ipfs-unixfs-importer';
import { sha256 } from 'multiformats/hashes/sha2';

import * as cbor from '@ipld/dag-cbor';
import * as Block from 'multiformats/block';

import _ from 'lodash';
import searchIndex from 'search-index';

import type { Message } from '../message';
import type { MessageStore } from './message-store';

/**
 * A simple implementation of {@link MessageStore} that works in both the browser and server-side.
 * Leverages LevelDB under the hood.
 */
export class MessageStoreLevel implements MessageStore {
  config: MessageStoreLevelConfig;
  db: BlockstoreLevel;
  // levelDB doesn't natively provide the querying capabilities needed for DWN. To accommodate, we're leveraging
  // a level-backed inverted index
  // TODO: search-index lib does not import type `SearchIndex`. find a workaround
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
    await this.db.open();

    // TODO: look into using the same level we're using for blockstore
    // TODO: parameterize `name`
    // calling `searchIndex` twice causes the process to hang, so check to see if the index
    // has already been "opened" before opening it again.
    if (!this.index) {
      this.index = await searchIndex({ name: this.config.indexLocation });
    }
  }


  async close(): Promise<void> {
    await this.db.close();
    await this.index.FLUSH();
  }

  async get(cid: CID): Promise<Message> {
    const bytes = await this.db.get(cid);

    if (!bytes) {
      return;
    }

    const block = await Block.decode({ bytes, codec: cbor, hasher: sha256 });

    return block.value as Message;
  }

  async query(query: any): Promise<Message[]> {
    const messages: Message[] = [];

    // copy the query provided to prevent any mutation
    const copy: any = { ...query };
    delete copy.method;

    // parse query into a query that is compatible with the index we're using
    const indexQueryTerms: string[] = MessageStoreLevel.buildIndexQueryTerms(copy);
    const { RESULTS: indexResults } = await this.index.QUERY({ AND: indexQueryTerms });

    // iterate through all index query results and fetch all messages from the underlying
    // blockstore in chunks of 15
    let promises = [];

    for (let i = 0; i < indexResults.length; i += 1) {
      const cid = CID.parse(indexResults[i]._id);
      promises.push(this.get(cid).catch(e => e));
    }

    const chunkedPromises = _.chunk(promises, 15);
    for (const chunk of chunkedPromises) {
      const results = await Promise.all(chunk);

      for (const result of results) {
        if (result instanceof Error) {
          // TODO: figure out how we want to handle errors here.
          console.log(result);
        } else {
          messages.push(result);
        }
      }
    }

    return messages;
  }


  async delete(cid: CID): Promise<void> {
    await this.db.delete(cid);
    await this.index.DELETE(cid.toString());

    return;
  }

  async put(message: Message): Promise<void> {
    const block = await Block.encode({ value: message, codec: cbor, hasher: sha256 });
    await this.db.put(block.cid, block.bytes);

    // index specific properties within message
    const { descriptor } = message;
    const { method, objectId } = descriptor;

    let indexDocument: any = { _id: block.cid.toString(), method, objectId };

    // TODO: clean this up and likely move it elsewhere (e.g. a different function) so that
    if (descriptor.method === 'PermissionsRequest') {
      indexDocument.ability = descriptor.ability;
      indexDocument.requster = descriptor.requester;
    }

    await this.index.PUT([indexDocument]);
  }

  /**
   * deletes everything in the underlying datastore and indes.
   */
  async clear(): Promise<void> {
    await this.db.clear();
    await this.index.FLUSH();
  }

  /**
   * recursively parses a query object into a list of flattened terms that can be used to query the search
   * index
   * @example
   * _buildIndexQueryParams({
   *  method  : 'PermissionsQuery',
   *    ability : {
   *      method : 'CollectionsQuery',
   *      schema : 'https://schema.org/MusicPlaylist'
   *    }
   * })
   * // returns ['ability.method:CollectionsQuery', 'ability.schema:https://schema.org/MusicPlaylist' ]
   * @param query - the query to parse
   * @param terms - internally used to collect terms
   * @param prefix - internally used to pass parent properties into recursive calls
   * @returns the list of terms
   */
  private static buildIndexQueryTerms(query: any, terms: string[] = [], prefix: string = '') {
    for (let property in query) {
      let val = query[property];

      if (_.isPlainObject(val)) {
        MessageStoreLevel.buildIndexQueryTerms(val, terms, `${prefix}${property}.`);
      } else {
        terms.push(`${prefix}${property}:${val}`);
      }
    }

    return terms;
  }
}

type MessageStoreLevelConfig = {
  blockstoreLocation?: string,
  indexLocation?: string,
};