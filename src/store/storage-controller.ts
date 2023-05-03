import type { EventLog } from '../event-log/event-log.js';
import type { Readable } from 'readable-stream';
import type { RecordsWriteMessage } from '../index.js';
import type { BaseMessage, Filter } from '../core/types.js';
import type { DataStore, GetResult } from './data-store.js';
import type { MessageStore, MessageStoreOptions } from './message-store.js';

import { DwnConstant } from '../core/dwn-constant.js';
import { Message } from '../core/message.js';
import { DataStream, Encoder } from '../index.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

/**
 * A class that provides an abstraction for the usage of BlockStore and DataStore.
 */
export class StorageController {

  constructor(private messageStore: MessageStore, private dataStore: DataStore, private eventLog: EventLog) {}

  /**
   * Puts the given message and data in storage.
   * @throws {DwnError} with `DwnErrorCode.MessageStoreDataCidMismatch`
   *                    if the data stream resulted in a data CID that mismatches with `dataCid` in the given message
   * @throws {DwnError} with `DwnErrorCode.MessageStoreDataNotFound`
   *                    if `dataCid` in `descriptor` is given, and `dataStream` is not given, and data for the message does not exist already
   * @throws {DwnError} with `DwnErrorCode.MessageStoreDataSizeMismatch`
   *                    if `dataSize` in `descriptor` given mismatches the actual data size
   */
  public async put(
    tenant: string,
    message: BaseMessage,
    indexes: { [key: string]: string },
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

    await this.messageStore.put(tenant, message, indexes);
    await this.eventLog.append(tenant, messageCid);
  }

  public async query(
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

  public async delete(
    tenant: string,
    message: BaseMessage
  ): Promise<void> {
    const messageCid = await Message.getCid(message);

    if (message.descriptor.dataCid !== undefined) {
      await this.dataStore.delete(tenant, messageCid, message.descriptor.dataCid);
    }

    await this.messageStore.delete(tenant, messageCid);
  }

  public getMessage(tenant: string, messageCid: string): Promise<BaseMessage|undefined> {
    return this.messageStore.get(tenant, messageCid);
  }

  public putMessage(
    tenant: string,
    messageJson: BaseMessage,
    indexes: Record<string, string>,
    options?: MessageStoreOptions
  ): Promise<void> {
    return this.messageStore.put(tenant, messageJson, indexes, options);
  }

  public queryMessages(tenant: string, filter: Filter, options?: MessageStoreOptions): Promise<BaseMessage[]> {
    return this.messageStore.query(tenant, filter, options);
  }

  public getData(tenant: string, messageCid: string, dataCid: string): Promise<GetResult|undefined> {
    return this.dataStore.get(tenant, messageCid, dataCid);
  }

  public appendEvent(tenant: string, messageCid: string): Promise<string>|undefined {
    return this.eventLog.append(tenant, messageCid);
  }

  public deleteEvents(tenant: string, deletedMessageCids: string[]): Promise<number>|undefined {
    return this.eventLog.deleteEventsByCid(tenant, deletedMessageCids);
  }
}

export type RecordsWriteMessageWithOptionalEncodedData = RecordsWriteMessage & { encodedData?: string };
