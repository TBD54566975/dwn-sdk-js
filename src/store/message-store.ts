import type { BaseMessage } from '../core/types.js';
import type { RangeCriterion } from '../interfaces/records/types.js';

export interface Options {
  signal?: AbortSignal;
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
   * @param indexes indexes (key-value pairs) to be included as part of this put operation
   */
  put(
    tenant: string,
    messageJson: BaseMessage,
    indexes: { [key: string]: string },
    options?: Options
  ): Promise<void>;

  /**
   * Fetches a single message by `cid` from the underlying store.
   * Returns `undefined` no message was found.
   */
  get(tenant: string, cid: string, options?: Options): Promise<BaseMessage | undefined>;

  /**
   * Queries the underlying store for messages that match the query provided.
   * The provided criteria are combined to form an AND filter for the query.
   * Returns an empty array if no messages are found
   * @param exactCriteria - criteria for exact matches
   * @param rangeCriteria - criteria for range matches
   */
  query(
    tenant: string,
    exactCriteria: { [key: string]: string },
    rangeCriteria?: { [key: string]: RangeCriterion },
    options?: Options
  ): Promise<BaseMessage[]>;

  /**
   * Deletes the message associated with the id provided.
   */
  delete(tenant: string, cid: string, options?: Options): Promise<void>;
}