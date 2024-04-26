import type { DataStore } from '../types/data-store.js';
import type { EventLog } from '../types/event-log.js';
import type { GenericMessage } from '../types/message-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { RecordsDeleteMessage, RecordsQueryReplyEntry, RecordsWriteMessage } from '../types/records-types.js';

import { DwnConstant } from '../core/dwn-constant.js';
import { Message } from '../core/message.js';
import { Records } from '../utils/records.js';
import { RecordsWrite } from '../interfaces/records-write.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

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
   * Purges (permanent hard-delete) all descendant's data of the given `recordId`.
   */
  public static async purgeRecordDescendants(
    tenant: string,
    recordId: string,
    messageStore: MessageStore,
    dataStore: DataStore,
    eventLog: EventLog
  ): Promise<void> {
    const filter = {
      interface : DwnInterfaceName.Records,
      parentId  : recordId
    };
    const { messages: childMessages } = await messageStore.query(tenant, [filter]);

    // group the child messages by `recordId`
    const recordIdToMessagesMap = new Map<string, GenericMessage[]>();
    for (const message of childMessages) {
      // get the recordId
      let recordId;
      if (Records.isRecordsWrite(message)) {
        recordId = message.recordId;
      } else {
        recordId = (message as RecordsDeleteMessage).descriptor.recordId;
      }

      if (!recordIdToMessagesMap.has(recordId)) {
        recordIdToMessagesMap.set(recordId, []);
      }
      recordIdToMessagesMap.get(recordId)!.push(message);
    }

    // purge all child's descendants first
    for (const childRecordId of recordIdToMessagesMap.keys()) {
      // purge the child's descendent messages first
      await StorageController.purgeRecordDescendants(tenant, childRecordId, messageStore, dataStore, eventLog);
    }

    // then purge the child messages themselves
    for (const childRecordId of recordIdToMessagesMap.keys()) {
      await StorageController.purgeRecordMessages(tenant, recordIdToMessagesMap.get(childRecordId)!, messageStore, dataStore, eventLog);
    }
  }

  /**
   * Purges (permanent hard-delete) all messages of the SAME `recordId` given and their associated data and events.
   * Assumes that the given `recordMessages` are all of the same `recordId`.
   */
  private static async purgeRecordMessages(
    tenant: string,
    recordMessages: GenericMessage[],
    messageStore: MessageStore,
    dataStore: DataStore,
    eventLog: EventLog
  ): Promise<void> {
    // delete the data from the data store first so no chance of orphaned data (not having a message referencing it) in case of server crash
    // NOTE: only the `RecordsWrite` with latest timestamp can possibly have data associated with it so we do this filtering as an optimization
    // NOTE: however there could still be no data associated with the `RecordsWrite` with newest timestamp, because either:
    //       1. the data is encoded with the message itself; or
    //       2. the newest `RecordsWrite` may not be the "true" latest state due to:
    //          a. sync has yet to write the latest `RecordsWrite`; or
    //          b. `recordMessages` maybe an incomplete page of results if the caller uses the paging in its query
    // Calling dataStore.delete() is a no-op if the data is not found, so we are safe to call it redundantly.
    const recordsWrites = recordMessages.filter((message) => message.descriptor.method === DwnMethodName.Write);
    const newestRecordsWrite = (await Message.getNewestMessage(recordsWrites)) as RecordsWriteMessage;
    await dataStore.delete(tenant, newestRecordsWrite.recordId, newestRecordsWrite.descriptor.dataCid);

    // then delete all events associated with the record messages before deleting the messages so we don't have orphaned events
    const messageCids = await Promise.all(recordMessages.map((message) => Message.getCid(message)));
    await eventLog.deleteEventsByCid(tenant, messageCids);

    // finally delete all record messages
    await Promise.all(messageCids.map((messageCid) => messageStore.delete(tenant, messageCid)));
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
