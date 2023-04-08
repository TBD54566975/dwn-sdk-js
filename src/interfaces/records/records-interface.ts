import type { DataStore } from '../../store/data-store.js';
import type { EventLog } from '../../event-log/event-log.js';
import type { MessageStore } from '../../store/message-store.js';
import type { RecordsWriteMessage } from '../../interfaces/records/types.js';
import type { TimestampedMessage } from '../../core/types.js';

import { constructRecordsWriteIndexes } from './handlers/records-write.js';
import { Message } from '../../core/message.js';
import { RecordsWrite } from './messages/records-write.js';
import { StorageController } from '../../store/storage-controller.js';

/**
 * Deletes all messages in `existingMessages` that are older than the `comparedToMessage` in the given tenant,
 * but keep the initial write write for future processing by ensuring its `isLatestBaseState` index is "false".
 */
export async function deleteAllOlderMessagesButKeepInitialWrite(
  tenant: string,
  existingMessages: TimestampedMessage[],
  comparedToMessage: TimestampedMessage,
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
        const indexes = await constructRecordsWriteIndexes(existingRecordsWrite, isLatestBaseState);
        await messageStore.put(tenant, message, indexes);
      } else {
        const messageCid = await Message.getCid(message);
        deletedMessageCids.push(messageCid);
      }
    }

    await eventLog.deleteEventsByCid(tenant, deletedMessageCids);
  }
}
