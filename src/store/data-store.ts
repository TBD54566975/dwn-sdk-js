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
   * @param messageCid CID of the message that references the data.
   * @returns The CID and size in number of bytes of the data stored.
   */
  put(tenant: string, messageCid: string, dataStream: Readable): Promise<PutResult>;

  /**
   * Fetches the specified data.
   * @param messageCid CID of the message that references the data.
   */
  get(tenant: string, messageCid: string, dataCid: string): Promise<Readable | undefined>;

  /**
   * Associates existing data.
   * @param tenant The tenant in which the data must exist under for the association to occur.
   * @param messageCid CID of the message that references the data.
   * @param dataCid The CID of the data stored.
   * @returns Whether data for the given CID was found under the tenant scope in the store.
   */
  associate(tenant: string, messageCid: string, dataCid: string): Promise<boolean>;

  /**
   * Deletes the specified data.
   * @param messageCid CID of the message that references the data.
   */
  delete(tenant: string, messageCid: string, dataCid: string): Promise<void>;
}

/**
 * Result of a data store `put()` method call.
 */
export type PutResult = {
  dataCid: string;
  dataSize: number;
};