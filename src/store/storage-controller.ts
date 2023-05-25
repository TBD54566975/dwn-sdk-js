import type { DataStore } from '../types/data-store.js';
import type { MessageStore } from '../types/message-store.js';
import type { BaseMessage, Filter } from '../types/message-types.js';

import { DwnConstant } from '../core/dwn-constant.js';
import { Message } from '../core/message.js';
import type { RecordsWriteMessage } from '../index.js';
import { DataStream, Encoder } from '../index.js';

/**
 * A class that provides an abstraction for the usage of MessageStore, DataStore, and EventLog.
 */
export class StorageController {
  public static async query(
    messageStore: MessageStore,
    dataStore: DataStore,
    tenant: string,
    filter: Filter
  ): Promise<RecordsWriteMessageWithOptionalEncodedData[]> {

    const messages: RecordsWriteMessageWithOptionalEncodedData[] = (await messageStore.query(tenant, filter)) as RecordsWriteMessage[];

    // for every message, only include the data as `encodedData` if the data size is equal or smaller than the size threshold
    for (const message of messages) {
      const dataCid = message.descriptor.dataCid;
      const dataSize = message.descriptor.dataSize;
      if (dataCid !== undefined && dataSize! <= DwnConstant.maxDataSizeAllowedToBeEncoded) {
        const messageCid = await Message.getCid(message);
        const result = await dataStore.get(tenant, messageCid, dataCid);

        if (result) {
          const dataBytes = await DataStream.toBytes(result.dataStream);
          message.encodedData = Encoder.bytesToBase64Url(dataBytes);
        }
      }
    }

    return messages;
  }

  public static async delete(
    messageStore: MessageStore,
    dataStore: DataStore,
    tenant: string,
    message: BaseMessage
  ): Promise<void> {
    const messageCid = await Message.getCid(message);

    if (message.descriptor.dataCid !== undefined) {
      await dataStore.delete(tenant, messageCid, message.descriptor.dataCid);
    }

    await messageStore.delete(tenant, messageCid);
  }
}

export type RecordsWriteMessageWithOptionalEncodedData = RecordsWriteMessage & { encodedData?: string };
