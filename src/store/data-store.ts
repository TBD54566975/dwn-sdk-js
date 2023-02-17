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
   * @returns The CID of the data stored.
   */
  put(tenant: string, logicalId: string, dataStream: Readable): Promise<string>;

  /**
   * Fetches the specified data.
   * TODO: #205 - https://github.com/TBD54566975/dwn-sdk-js/issues/205
   * change return type from Uint8Array to a readable stream
   * @param logicalId This may be the ID of a record, or the ID of a protocol definition etc.
   */
  get(tenant: string, logicalId: string, dataCid: string): Promise<Uint8Array | undefined>;

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