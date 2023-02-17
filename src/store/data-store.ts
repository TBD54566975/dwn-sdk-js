import type { Readable } from 'readable-stream';

/**
 * The interface that defines how to store and fetch data associated with a message
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
   * @returns The CID of the data stored.
   */
  put(tenant: string, recordId: string, dataStream: Readable): Promise<string>;

  /**
   * Fetches the specified data.
   * TODO: change return type from Uint8Array to a readable stream
   */
  get(tenant: string, recordId: string, dataCid: string): Promise<Uint8Array | undefined>;

  /**
   * Deletes the specified data;
   */
  delete(tenant: string, recordId: string, dataCid: string): Promise<void>;
}