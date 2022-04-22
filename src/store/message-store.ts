import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';

import * as cbor from '@ipld/dag-cbor';
import * as Block from 'multiformats/block';

import _ from 'lodash';
import searchIndex from 'search-index';

import { BlockstoreLevel } from './blockstore-level';
import { Message } from '../message';

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

  async get(cid: CID): Promise<Message> {
    const bytes = await this.db.get(cid);
    const block = await Block.decode({ bytes, codec: cbor, hasher: sha256 });

    return block.value as Message;
  }

  async query(query: any): Promise<Message[]> {
    const messages: Message[] = [];

    let copy: any = { ...query };
    delete copy.method;

    const indexQueryTerms: string[] = MessageStoreLevel._buildIndexQueryTerms(copy);
    const { RESULTS: indexResults } = await this.index.QUERY({ AND: indexQueryTerms });

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

    let indexDocument: any = { method, objectId };

    // TODO: clean this up and likely move it elsewhere (e.g. a different function) so that
    if (descriptor.method === 'PermissionsRequest') {
      indexDocument.ability = descriptor.ability;
      indexDocument.requster = descriptor.requester;
    }

    await this.index.PUT([indexDocument]);
  }

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
   * @param id
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
   * @param id
   * @returns a boolean indicating whether the message was found and deleted
   */
  delete(cid: CID): Promise<void>;

}

function sleep(durationMillis): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMillis);
  });
}