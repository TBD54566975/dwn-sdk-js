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
   * @param logicalId This may be the ID of a record, or the ID of a protocol definition etc.
   * @returns The CID and size in number of bytes of the data stored.
   */
  put(tenant: string, logicalId: string, dataStream: Readable): Promise<PutResult>;

  /**
   * Fetches the specified data.
   * @param logicalId This may be the ID of a record, or the ID of a protocol definition etc.
   */
  get(tenant: string, logicalId: string, dataCid: string): Promise<Readable | undefined>;

  /**
   * Checks to see if the store has the specified data.
   * @param logicalId This may be the ID of a record, or the ID of a protocol definition etc.
   */
  has(tenant: string, logicalId: string, dataCid: string): Promise<boolean>;

  /**
   * Deletes the specified data;
   * @param logicalId This may be the ID of a record, or the ID of a protocol definition etc.
   */
  delete(tenant: string, logicalId: string, dataCid: string): Promise<void>;
}

/**
 * Result of a data store `put()` method call.
 */
export type PutResult = {
  dataCid: string;
  dataSize: number;
};