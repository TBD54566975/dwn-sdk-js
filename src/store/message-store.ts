import type { BaseMessage, Filter } from '../core/types.js';

export interface MessageStoreOptions {
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
    options?: MessageStoreOptions
  ): Promise<void>;

  /**
   * Fetches a single message by `cid` from the underlying store.
   * Returns `undefined` no message was found.
   */
  get(tenant: string, cid: string, options?: MessageStoreOptions): Promise<BaseMessage | undefined>;

  /**
   * Queries the underlying store for messages that match the provided filter.
   */
  query(tenant: string, filter: Filter, options?: MessageStoreOptions ): Promise<BaseMessage[]>;

  /**
   * Deletes the message associated with the id provided.
   */
  delete(tenant: string, cid: string, options?: MessageStoreOptions): Promise<void>;
}