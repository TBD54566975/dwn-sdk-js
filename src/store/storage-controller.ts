import type { DataStore, } from './data-store.js';
import type { EventLog } from '../event-log/event-log.js';
import type { MessageStore } from './message-store.js';
import type { Readable } from 'readable-stream';
import type { RecordsWriteMessage } from '../index.js';
import type { BaseMessage, Filter } from '../core/types.js';

import { DwnConstant } from '../core/dwn-constant.js';
import { Message } from '../core/message.js';
import { DataStream, Encoder } from '../index.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

/**
 * A class that provides an abstraction for the usage of BlockStore and DataStore.
 */

export class StorageController {

  constructor(private messageStore: MessageStore, private dataStore: DataStore, private eventLog: EventLog) { }

  public appendEvent(...args: Parameters<typeof this.eventLog.append>): ReturnType<typeof this.eventLog.append> {
    return this.eventLog.append.apply(this.eventLog, args);
  }

  public deleteEvents(...args: Parameters<typeof this.eventLog.deleteEventsByCid>): ReturnType<typeof this.eventLog.deleteEventsByCid> {
    return this.eventLog.deleteEventsByCid.apply(this.eventLog, args);
  }

  public getData(...args: Parameters<typeof this.dataStore.get>): ReturnType<typeof this.dataStore.get> {
    return this.dataStore.get.apply(this.dataStore, args);
  }

  public getMessage(...args: Parameters<typeof this.messageStore.get>): ReturnType<typeof this.messageStore.get> {
    return this.messageStore.get.apply(this.messageStore, args);
  }

  public async deleteMessage(
    tenant: string,
    message: BaseMessage
  ): Promise<void> {
    const messageCid = await Message.getCid(message);

    if (message.descriptor.dataCid !== undefined) {
      await this.dataStore.delete(tenant, messageCid, message.descriptor.dataCid);
    }

    await this.messageStore.delete(tenant, messageCid);
  }

  public putMessageWithoutData(...args: Parameters<typeof this.messageStore.put>): ReturnType<typeof this.messageStore.put> {
    return this.messageStore.put.apply(this.messageStore, args);
  }

  /**
   * Puts the given message and data in storage.
   * @throws {DwnError} with `DwnErrorCode.MessageStoreDataCidMismatch`
   *                    if the data stream resulted in a data CID that mismatches with `dataCid` in the given message
   * @throws {DwnError} with `DwnErrorCode.MessageStoreDataNotFound`
   *                    if `dataCid` in `descriptor` is given, and `dataStream` is not given, and data for the message does not exist already
   * @throws {DwnError} with `DwnErrorCode.MessageStoreDataSizeMismatch`
   *                    if `dataSize` in `descriptor` given mismatches the actual data size
   */
  public async putWithData(
    tenant: string,
    message: BaseMessage,
    indexes: Record<string, string>,
    dataStream?: Readable
  ): Promise<void> {
    const messageCid = await Message.getCid(message);

    // if `dataCid` is given, it means there is corresponding data associated with this message
    // but NOTE: it is possible that a data stream is not given in such case, for instance,
    // a subsequent RecordsWrite that changes the `published` property, but the data hasn't changed,
    // in this case requiring re-uploading of the data is extremely inefficient so we take care allow omission of data stream
    if (message.descriptor.dataCid !== undefined) {
      let result;

      if (dataStream === undefined) {
        result = await this.dataStore.associate(tenant, messageCid, message.descriptor.dataCid);
      } else {
        result = await this.dataStore.put(tenant, messageCid, message.descriptor.dataCid, dataStream);
      }

      // the message implies that the data is already in the DB, so we check to make sure the data already exist
      if (!result) {
        throw new DwnError(
          DwnErrorCode.MessageStoreDataNotFound,
          `data with dataCid ${message.descriptor.dataCid} not found in store`
        );
      }

      // MUST verify that the size of the actual data matches with the given `dataSize`
      // if data size is wrong, delete the data we just stored
      if (message.descriptor.dataSize !== result.dataSize) {
        // there is an opportunity to improve here: handle the edge cae of if the delete fails...
        await this.dataStore.delete(tenant, messageCid, message.descriptor.dataCid);

        throw new DwnError(
          DwnErrorCode.MessageStoreDataSizeMismatch,
          `actual data size ${result.dataSize} bytes does not match dataSize in descriptor: ${message.descriptor.dataSize}`
        );
      }

      // MUST verify that the CID of the actual data matches with the given `dataCid`
      // if data CID is wrong, delete the data we just stored
      if (message.descriptor.dataCid !== result.dataCid) {
        // there is an opportunity to improve here: handle the edge cae of if the delete fails...
        await this.dataStore.delete(tenant, messageCid, message.descriptor.dataCid);

        throw new DwnError(
          DwnErrorCode.MessageStoreDataCidMismatch,
          `actual data CID ${result.dataCid} does not match dataCid in descriptor: ${message.descriptor.dataCid}`
        );
      }
    }

    await this.putMessageWithoutData(tenant, message, indexes);
    await this.appendEvent(tenant, messageCid);
  }

  public queryMessages(...args: Parameters<typeof this.messageStore.query>): ReturnType<typeof this.messageStore.query> {
    return this.messageStore.query.apply(this.messageStore, args);
  }

  public async queryRecordsWrites(
    tenant: string,
    filter: Filter
  ): Promise<RecordsWriteMessageWithOptionalEncodedData[]> {

    const messages: RecordsWriteMessageWithOptionalEncodedData[] = (await this.messageStore.query(tenant, filter)) as RecordsWriteMessage[];

    // for every message, only include the data as `encodedData` if the data size is equal or smaller than the size threshold
    for (const message of messages) {
      const dataCid = message.descriptor.dataCid;
      const dataSize = message.descriptor.dataSize;
      if (dataCid !== undefined && dataSize! <= DwnConstant.maxDataSizeAllowedToBeEncoded) {
        const messageCid = await Message.getCid(message);
        const result = await this.dataStore.get(tenant, messageCid, dataCid);

        if (result) {
          const dataBytes = await DataStream.toBytes(result.dataStream);
          message.encodedData = Encoder.bytesToBase64Url(dataBytes);
        }
      }
    }

    return messages;
  }
}

export type RecordsWriteMessageWithOptionalEncodedData = RecordsWriteMessage & { encodedData?: string };
