import type { DataStore } from '../types/data-store.js';
import type { EventLog } from '../types/event-log.js';
import type { GenericMessage } from '../types/message-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { RecordsQueryReplyEntry, RecordsWriteMessage } from '../types/records-types.js';

import { DwnConstant } from '../core/dwn-constant.js';
import { DwnMethodName } from '../enums/dwn-interface-method.js';
import { Message } from '../core/message.js';
import { RecordsWrite } from '../interfaces/records-write.js';

/**
 * A class that provides an abstraction for the usage of MessageStore, DataStore, and EventLog.
 */
export class StorageController {
  /**
   * Deletes the data referenced by the given message if needed.
   * @param message The message to check if the data it references should be deleted.
   */
  private static async deleteFromDataStoreIfNeeded(
    dataStore: DataStore,
    tenant: string,
    message: GenericMessage,
    newestMessage: GenericMessage
  ): Promise<void> {
    if (message.descriptor.method !== DwnMethodName.Write) {
      return;
    }

    const recordsWriteMessage = message as RecordsWriteMessage;

    // Optional short-circuit optimization to avoid unnecessary data store call since the data should be encoded with the message itself in this case,
    // but data store call is a no-op thus code still works correctly even if this short-circuit is removed.
    if (recordsWriteMessage.descriptor.dataSize <= DwnConstant.maxDataSizeAllowedToBeEncoded) {
      return;
    }

    // We must still keep the data if the newest message still references the same data.
    if (recordsWriteMessage.descriptor.dataCid === (newestMessage as RecordsWriteMessage).descriptor.dataCid) {
      return;
    }

    // Else we delete the data from the data store.
    await dataStore.delete(tenant, recordsWriteMessage.recordId, recordsWriteMessage.descriptor.dataCid);
  }

  /**
   * Deletes all messages in `existingMessages` that are older than the `newestMessage` in the given tenant,
   * but keep the initial write write for future processing by ensuring its `isLatestBaseState` index is "false".
   */
  public static async deleteAllOlderMessagesButKeepInitialWrite(
    tenant: string,
    existingMessages: GenericMessage[],
    newestMessage: GenericMessage,
    messageStore: MessageStore,
    dataStore: DataStore,
    eventLog: EventLog
  ): Promise<void> {
    const deletedMessageCids: string[] = [];

    // NOTE: under normal operation, there should only be at most two existing records per `recordId` (initial + a potential subsequent write/delete),
    // but the DWN may crash before `delete()` is called below, so we use a loop as a tactic to clean up lingering data as needed
    for (const message of existingMessages) {
      const messageIsOld = await Message.isOlder(message, newestMessage);
      if (messageIsOld) {
        // the easiest implementation here is delete each old messages
        // and re-create it with the right index (isLatestBaseState = 'false') if the message is the initial write,
        // but there is room for better/more efficient implementation here

        await StorageController.deleteFromDataStoreIfNeeded(dataStore, tenant, message, newestMessage);

        // delete message from message store
        const messageCid = await Message.getCid(message);
        await messageStore.delete(tenant, messageCid);

        // if the existing message is the initial write
        // we actually need to keep it BUT, need to ensure the message is no longer marked as the latest state
        const existingMessageIsInitialWrite = await RecordsWrite.isInitialWrite(message);
        if (existingMessageIsInitialWrite) {
          const existingRecordsWrite = await RecordsWrite.parse(message as RecordsWriteMessage);
          const isLatestBaseState = false;
          const indexes = await existingRecordsWrite.constructIndexes(isLatestBaseState);
          const writeMessage = message as RecordsQueryReplyEntry;
          delete writeMessage.encodedData;
          await messageStore.put(tenant, writeMessage, indexes);
        } else {
          const messageCid = await Message.getCid(message);
          deletedMessageCids.push(messageCid);
        }
      }

      await eventLog.deleteEventsByCid(tenant, deletedMessageCids);
    }
  }
}
