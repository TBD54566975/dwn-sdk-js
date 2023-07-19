import type { Filter, GenericMessage } from './message-types.js';

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
    message: GenericMessage,
    indexes: { [key: string]: string | boolean },
    options?: MessageStoreOptions
  ): Promise<void>;

  /**
   * Fetches a single message by `cid` from the underlying store.
   * Returns `undefined` no message was found.
   */
  get(tenant: string, cid: string, options?: MessageStoreOptions): Promise<GenericMessage | undefined>;

  /**
   * Queries the underlying store for messages that match the provided filter.
   */
  query(tenant: string, filter: Filter, options?: MessageStoreOptions ): Promise<GenericMessage[]>;

  /**
   * Deletes the message associated with the id provided.
   */
  delete(tenant: string, cid: string, options?: MessageStoreOptions): Promise<void>;

  /**
   * Clears the entire store. Mainly used for cleaning up in test environment.
   */
  clear(): Promise<void>;
}