import type { DataStore } from '../types/data-store.js';
import type { EventLog } from '../types/event-log.js';
import type { GenericMessage } from '../types/message-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { RecordsWriteMessage, RecordsWriteMessageWithOptionalEncodedData } from '../types/records-types.js';

import { DwnConstant } from '../core/dwn-constant.js';
import { DwnMethodName } from '../enums/dwn-interface-method.js';
import { Message } from '../core/message.js';
import { RecordsWrite } from '../interfaces/records-write.js';

/**
 * A class that provides an abstraction for the usage of MessageStore, DataStore, and EventLog.
 */
export class StorageController {
  /**
   * Deletes a message.
   */
  private static async delete(
    messageStore: MessageStore,
    dataStore: DataStore,
    tenant: string,
    message: GenericMessage
  ): Promise<void> {
    const messageCid = await Message.getCid(message);

    if (message.descriptor.method === DwnMethodName.Write &&
        (message as RecordsWriteMessage).descriptor.dataSize > DwnConstant.maxDataSizeAllowedToBeEncoded) {
      const recordsWriteMessage = message as RecordsWriteMessage;
      await dataStore.delete(tenant, messageCid, recordsWriteMessage.descriptor.dataCid);
    }

    await messageStore.delete(tenant, messageCid);
  }


  /**
   * Deletes all messages in `existingMessages` that are older than the `comparedToMessage` in the given tenant,
   * but keep the initial write write for future processing by ensuring its `isLatestBaseState` index is "false".
   */
  public static async deleteAllOlderMessagesButKeepInitialWrite(
    tenant: string,
    existingMessages: GenericMessage[],
    comparedToMessage: GenericMessage,
    messageStore: MessageStore,
    dataStore: DataStore,
    eventLog: EventLog
  ): Promise<void> {
    const deletedMessageCids: string[] = [];

    // NOTE: under normal operation, there should only be at most two existing records per `recordId` (initial + a potential subsequent write/delete),
    // but the DWN may crash before `delete()` is called below, so we use a loop as a tactic to clean up lingering data as needed
    for (const message of existingMessages) {
      const messageIsOld = await Message.isOlder(message, comparedToMessage);
      if (messageIsOld) {
      // the easiest implementation here is delete each old messages
      // and re-create it with the right index (isLatestBaseState = 'false') if the message is the initial write,
      // but there is room for better/more efficient implementation here
        await StorageController.delete(messageStore, dataStore, tenant, message);

        // if the existing message is the initial write
        // we actually need to keep it BUT, need to ensure the message is no longer marked as the latest state
        const existingMessageIsInitialWrite = await RecordsWrite.isInitialWrite(message);
        if (existingMessageIsInitialWrite) {
          const existingRecordsWrite = await RecordsWrite.parse(message as RecordsWriteMessage);
          const isLatestBaseState = false;
          const indexes = await existingRecordsWrite.constructRecordsWriteIndexes(isLatestBaseState);
          const writeMessage = message as RecordsWriteMessageWithOptionalEncodedData;
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
