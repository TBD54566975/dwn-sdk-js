import type { BaseMessage } from '../core/types';

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
   * @param author Author who signed the `authorization` property.
   *               This is included mainly as a performance optimization, because the data can technically be extracted from the given message itself.
   *               We may want to pass in a wrapper class of the message that encapsulate this info as a further improvement.
   */
  put(messageJson: BaseMessage, author: string): Promise<void>;
  /**
   * fetches a single message by `cid` from the underlying store. Returns `undefined`
   * if no message was found
   * @param cid
   */
  get(cid: CID): Promise<BaseMessage>;
  /**
   * queries the underlying store for messages that match the query provided.
   * returns an empty array if no messages are found
   * @param includeCriteria - "AND" criteria for what to include
   * @param excludeCriteriay - "AND" criteria for what to exclude
   */
  // TODO: change type of `query`, Issue $69 https://github.com/TBD54566975/dwn-sdk-js/issues/69
  query(includeCriteria: any, excludeCriteria?: any): Promise<BaseMessage[]>;

  /**
   * deletes the message associated to the id provided
   * @param cid
   */
  delete(cid: CID): Promise<void>;
}