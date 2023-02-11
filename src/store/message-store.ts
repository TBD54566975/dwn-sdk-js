import type { BaseMessage } from '../core/types.js';
import { RangeCriterion } from '../interfaces/records/types.js';
import { Readable } from 'readable-stream';

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
   * @throws {DwnError} with `DwnErrorCode.MessageStoreDataCidMismatch`
   *                    if the data stream resulted in a data CID that mismatches with `dataCid` in the given message
   * @throws {DwnError} with `DwnErrorCode.MessageStoreDataNotFound`
   *                    if `dataCid` in `descriptor` is given, and `dataStream` is not given, and data for the message does not exist already
   */
  put(messageJson: BaseMessage, indexes: { [key: string]: string }, dataStream?: Readable): Promise<void>;

  /**
   * fetches a single message by `cid` from the underlying store. Returns `undefined`
   * if no message was found
   */
  get(cid: string): Promise<BaseMessage>;

  /**
   * Queries the underlying store for messages that match the query provided.
   * The provided criteria are combined to form an AND filter for the query.
   * Returns an empty array if no messages are found
   * @param exactCriteria - criteria for exact matches
   * @param rangeCriteria - criteria for range matches
   */
  query(
    exactCriteria: { [key: string]: string },
    rangeCriteria?: { [key: string]: RangeCriterion }
  ): Promise<BaseMessage[]>;

  /**
   * Deletes the message associated with the id provided.
   */
  delete(cid: string): Promise<void>;
}