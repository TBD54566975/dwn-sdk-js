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
   * Stores the given data.
   * @param recordId The logical ID of the record that references the data.
   * @param dataCid The IPFS CID of the data.
   */
  put(tenant: string, recordId: string, dataCid: string, dataStream: Readable): Promise<DataStorePutResult>;

  /**
   * Fetches the specified data.
   * @param recordId The logical ID of the record that references the data.
   * @param dataCid The IPFS CID of the data.
   * @returns the data size and data stream if found, otherwise `undefined`.
   */
  get(tenant: string, recordId: string, dataCid: string): Promise<DataStoreGetResult | undefined>;

  /**
   * Deletes the specified data. No-op if the data does not exist.
   * @param recordId The logical ID of the record that references the data.
   * @param dataCid The IPFS CID of the data.
   */
  delete(tenant: string, recordId: string, dataCid: string): Promise<void>;

  /**
   * Clears the entire store. Mainly used for testing to cleaning up in test environments.
   */
  clear(): Promise<void>;
}

/**
 * Result of a data store `put()` method call.
 */
export type DataStorePutResult = {
  /**
   * The number of bytes of the data stored.
   */
  dataSize: number;
};

/**
 * Result of a data store `get()` method call if the data exists.
 */
export type DataStoreGetResult = {
  /**
   * The number of bytes of the data stored.
   */
  dataSize: number;
  dataStream: Readable;
};
