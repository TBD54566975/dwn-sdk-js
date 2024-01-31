import type { Readable } from 'readable-stream';

/**
 * The interface that defines how to store and fetch data associated with a message.
 */
export interface DataStore {
  /**
   * Opens a connection to the underlying store.
   */
  open(): Promise<void>;

  /**
   * Closes the connection to the underlying store.
   */
  close(): Promise<void>;

  /**
   * Puts the given data in store.
   * It is expected that the CID of the dataStream matches the given dataCid.
   * The returned dataCid and returned dataSize will be verified against the given dataCid (and inferred dataSize).
   * @param messageCid CID of the message that references the data.
   * @returns The CID and size in number of bytes of the data stored.
   */
  put(tenant: string, messageCid: string, dataCid: string, dataStream: Readable): Promise<PutResult>;

  /**
   * Fetches the specified data.
   * The returned dataCid and returned dataSize will be verified against the given dataCid (and inferred dataSize).
   * @param messageCid CID of the message that references the data.
   */
  get(tenant: string, messageCid: string, dataCid: string): Promise<GetResult | undefined>;

  /**
   * Deletes the specified data.
   * @param messageCid CID of the message that references the data.
   */
  delete(tenant: string, messageCid: string, dataCid: string): Promise<void>;

  /**
   * Clears the entire store. Mainly used for cleaning up in test environment.
   */
  clear(): Promise<void>;
}

/**
 * Result of a data store `put()` method call.
 */
export type PutResult = {
  dataSize: number;
};

/**
 * Result of a data store `get()` method call.
 */
export type GetResult = {
  dataSize: number;
  dataStream: Readable;
};
