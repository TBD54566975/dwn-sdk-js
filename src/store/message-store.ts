import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';

import * as cbor from '@ipld/dag-cbor';
import * as Block from 'multiformats/block';

import _ from 'lodash';
import searchIndex from 'search-index';

import { BlockstoreLevel } from './blockstore-level';
import { Message } from '../message';

/**
 * A simple implementation of {@link MessageStore} that works in both the browser and server-side.
 * Leverages LevelDB under the hood.
 */
export class MessageStoreLevel implements MessageStore {
  db: BlockstoreLevel;
  // TODO: search-index lib does not import type `SearchIndex`. find a workaround
  index;

  /**
   * @param location - must be a directory path (relative or absolute) where LevelDB will store its
   * files, or in browsers, the name of
   * the {@link https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase IDBDatabase}
   * to be opened.
   */
  constructor(location?: string) {
    this.db = new BlockstoreLevel(location);
  }

  /**
   * opens a connection to the underlying store
   */
  async open(): Promise<void> {
    await this.db.open();

    // TODO: look into using the same level we're using for blockstore
    // TODO: parameterize `name`
    this.index = await searchIndex({ name: 'INDEX' });
  }

  /**
   * releases all file handles and locks held by the underlying db.
   */
  async close(): Promise<void> {
    await this.db.close();
  }

  /**
   * fetches a single message by `cid` from the underlying store. Returns `undefined`
   * if no message was found
   * @param cid
   */
  async get(cid: CID): Promise<Message> {
    const bytes = await this.db.get(cid);
    const block = await Block.decode({ bytes, codec: cbor, hasher: sha256 });

    return block.value as Message;
  }

  /**
   * queries the underlying store for messages that match the query provided.
   * returns an empty array if no messages are found
   * @param query
   */
  async query(query: any): Promise<Message[]> {
    const messages: Message[] = [];

    // copy the query provided to prevent any mutation
    let copy: any = { ...query };
    delete copy.method;

    // parse query into a query that is compatible with the index we're using
    const indexQueryTerms: string[] = MessageStoreLevel._buildIndexQueryTerms(copy);
    const { RESULTS: indexResults } = await this.index.QUERY({ AND: indexQueryTerms });

    // iterate through all index query results and fetch all messages from the underlying
    // blockstore in chunks of 15
    let promises = [];

    for (let i = 0; i < indexResults.length; i += 1) {
      const cid = CID.parse(indexResults[i]._id);
      promises.push(this.get(cid).catch(e => e));
    }

    const chunkedPromises = _.chunk(promises, 15);
    for (let chunk of chunkedPromises) {
      const results = await Promise.all(chunk);

      for (let result of results) {
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

  /**
   * deletes the message associated to the cid provided.
   * @param cid
   */
  async delete(cid: CID): Promise<void> {
    await this.db.delete(cid);
    await this.index.DELETE(cid.toString());

    return;
  }

  /**
   * adds a message to the underlying store. Uses the message's cid as the key
   * @param message
   */
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
  static _buildIndexQueryTerms(query: any, terms: string[] = [], prefix: string = '') {
    for (let property in query) {
      let val = query[property];

      if (_.isPlainObject(val)) {
        MessageStoreLevel._buildIndexQueryTerms(val, terms, `${prefix}${property}.`);
      } else {
        terms.push(`${prefix}${property}:${val}`);
      }
    }

    return terms;
  }
}

export interface MessageStore {
  /**
   * opens a connection to the underlying store
   */
  open(): Promise<void>;
  /**
   * closes the connection to the underlying store
   */
  close(): Promise<void>;
  /**
   * adds a message to the underlying store. Uses the message's cid as the key
   * @param message
   */
  put(message: Message): Promise<void>;
  /**
   * fetches a single message by `cid` from the underlying store. Returns `undefined`
   * if no message was found
   * @param cid
   */
  get(cid: CID): Promise<Message>;
  /**
   * queries the underlying store for messages that match the query provided.
   * returns an empty array if no messages are found
   * @param query
   */
  // TODO: change type of `query`
  query(query: any): Promise<Message[]>;

  /**
   * deletes the message associated to the id provided
   * @param cid
   */
  delete(cid: CID): Promise<void>;

}