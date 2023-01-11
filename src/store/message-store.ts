import type { BaseMessage } from '../core/types.js';

import { CID } from 'multiformats/cid';

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
   * @param indexes indexes (key-value pairs) to be included as part of this put operation
   */
  put(messageJson: BaseMessage, indexes: { [key: string]: string }): Promise<void>;

  /**
   * fetches a single message by `cid` from the underlying store. Returns `undefined`
   * if no message was found
   * @param cid
   */
  get(cid: CID): Promise<BaseMessage>;

  /**
   * queries the underlying store for messages that match the query provided.
   * returns an empty array if no messages are found
   * @param criteria - "AND" criteria for what to include
   */
  query(criteria: any): Promise<BaseMessage[]>;

  /**
   * deletes the message associated to the id provided
   * @param cid
   */
  delete(cid: CID): Promise<void>;
}