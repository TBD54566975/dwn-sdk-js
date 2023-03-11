import { DataStore } from './data-store.js';
import { MessageStore } from './message-store.js';
import { Readable } from 'readable-stream';
import { BaseMessage, Filter } from '../core/types.js';

import { DataStream, Encoder } from '../index.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

/**
 * A class that provides an abstraction for the usage of BlockStore and DataStore.
 */
export class StorageController {
  /**
   * Puts the given message and data in storage.
   * @throws {DwnError} with `DwnErrorCode.MessageStoreDataCidMismatch`
   *                    if the data stream resulted in a data CID that mismatches with `dataCid` in the given message
   * @throws {DwnError} with `DwnErrorCode.MessageStoreDataNotFound`
   *                    if `dataCid` in `descriptor` is given, and `dataStream` is not given, and data for the message does not exist already
   * @throws {DwnError} with `DwnErrorCode.MessageStoreDataSizeMismatch`
   *                    if `dataSize` in `descriptor` given mismatches the actual data size
   */
  public static async put(
    messageStore: MessageStore,
    dataStore: DataStore,
    tenant: string,
    message: BaseMessage,
    indexes: { [key: string]: string },
    dataStream?: Readable
  ): Promise<void> {
    // if `dataCid` is given, it means there is corresponding data associated with this message
    // but NOTE: it is possible that a data stream is not given in such case, for instance,
    // a subsequent RecordsWrite that changes the `published` property, but the data hasn't changed,
    // in this case requiring re-uploading of the data is extremely inefficient so we take care allow omission of data stream
    if (message.descriptor.dataCid !== undefined) {
      if (dataStream === undefined) {
        // the message implies that the data is already in the DB, so we check to make sure the data already exist
        // TODO: #218 - Use tenant + record scoped IDs - https://github.com/TBD54566975/dwn-sdk-js/issues/218
        const hasData = await dataStore.has(tenant, 'not used yet', message.descriptor.dataCid);

        if (!hasData) {
          throw new DwnError(
            DwnErrorCode.MessageStoreDataNotFound,
            `data with dataCid ${message.descriptor.dataCid} not found in store`
          );
        }
      } else {
        const { dataCid, dataSize } = await dataStore.put(tenant, 'not used yet', dataStream);

        // MUST verify that the size of the actual data matches with the given `dataSize`
        // if data size is wrong, delete the data we just stored
        if (message.descriptor.dataSize !== dataSize) {
          // there is an opportunity to improve here: handle the edge cae of if the delete fails...
          await dataStore.delete(tenant, 'not used yet', dataCid);

          throw new DwnError(
            DwnErrorCode.MessageStoreDataSizeMismatch,
            `actual data size ${dataSize} bytes does not match dataSize in descriptor: ${message.descriptor.dataSize}`
          );
        }

        // MUST verify that the CID of the actual data matches with the given `dataCid`
        // if data CID is wrong, delete the data we just stored
        if (message.descriptor.dataCid !== dataCid) {
          // there is an opportunity to improve here: handle the edge cae of if the delete fails...
          await dataStore.delete(tenant, 'not used yet', dataCid);

          throw new DwnError(
            DwnErrorCode.MessageStoreDataCidMismatch,
            `actual data CID ${dataCid} does not match dataCid in descriptor: ${message.descriptor.dataCid}`
          );
        }
      }
    }

    await messageStore.put(tenant, message, indexes);
  }

  public static async query(
    messageStore: MessageStore,
    dataStore: DataStore,
    tenant: string,
    filter: Filter
  ): Promise<BaseMessage[]> {

    const messages = await messageStore.query(tenant, filter);

    for (const message of messages) {
      const dataCid = message.descriptor.dataCid;
      if (dataCid !== undefined) {
        // TODO: #219 (https://github.com/TBD54566975/dwn-sdk-js/issues/219)
        // temporary placeholder for keeping status-quo of returning data in `encodedData`
        // once #219 is implemented, `encodedData` may or may not exist directly as part of the returned message here
        const readableStream = await dataStore.get(tenant, 'not used yet', dataCid);
        const dataBytes = await DataStream.toBytes(readableStream);

        message['encodedData'] = Encoder.bytesToBase64Url(dataBytes);
      }
    }

    return messages;
  }
}
