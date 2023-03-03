import { BaseMessage } from '../core/types.js';
import { DataStore } from './data-store.js';
import { MessageStore } from './message-store.js';
import { RangeCriterion } from '../interfaces/records/types.js';
import { Readable } from 'readable-stream';

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
   */
  public static async put(
    messageStore: MessageStore,
    dataStore: DataStore,
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
        const hasData = await dataStore.has('not used yet', 'not used yet', message.descriptor.dataCid);

        if (!hasData) {
          throw new DwnError(
            DwnErrorCode.MessageStoreDataNotFound,
            `data with dataCid ${message.descriptor.dataCid} not found in store`
          );
        }
      } else {
        const actualDataCid = await dataStore.put('not used yet', 'not used yet', dataStream );

        // MUST verify that the CID of the actual data matches with the given `dataCid`
        // if data CID is wrong, delete the data we just stored
        if (message.descriptor.dataCid !== actualDataCid) {
          // there is an opportunity to improve here: handle the edge cae of if the delete fails...
          await dataStore.delete('not used yet', 'not used yet', actualDataCid);
          throw new DwnError(
            DwnErrorCode.MessageStoreDataCidMismatch,
            `actual data CID ${actualDataCid} does not match dataCid in descriptor: ${message.descriptor.dataCid}`
          );
        }
      }
    }

    await messageStore.put(message, indexes);
  }

  public static async query(
    messageStore: MessageStore,
    dataStore: DataStore,
    exactCriteria: { [key: string]: string },
    rangeCriteria?: { [key: string]: RangeCriterion }
  ): Promise<BaseMessage[]> {

    const messages = await messageStore.query(exactCriteria, rangeCriteria);

    for (const message of messages) {
      const dataCid = message.descriptor.dataCid;
      if (dataCid !== undefined) {
        // TODO: #219 (https://github.com/TBD54566975/dwn-sdk-js/issues/219)
        // temporary placeholder for keeping status-quo of returning data in `encodedData`
        // once #219 is implemented, `encodedData` may or may not exist directly as part of the returned message here
        const readableStream = await dataStore.get('not used yet', 'not used yet', dataCid);
        const dataBytes = await DataStream.toBytes(readableStream);

        message['encodedData'] = Encoder.bytesToBase64Url(dataBytes);
      }
    }

    return messages;
  }
}
