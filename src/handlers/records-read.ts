import type { MethodHandler } from '../types/method-handler.js';
import type { RecordsWriteMessageWithOptionalEncodedData } from '../store/storage-controller.js';
import type { DataStore, DidResolver, Filter, MessageStore } from '../index.js';
import type { RecordsReadMessage, RecordsReadReply, RecordsWriteMessage } from '../types/records-types.js';

import { authenticate } from '../core/auth.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { Records } from '../utils/records.js';
import { RecordsRead } from '../interfaces/records-read.js';
import { RecordsWrite } from '../interfaces/records-write.js';
import { DataStream, DwnError, DwnErrorCode, Encoder } from '../index.js';
import { DwnInterfaceName, DwnMethodName } from '../core/message.js';

export class RecordsReadHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private messageStore: MessageStore, private dataStore: DataStore) { }

  public async handle({
    tenant,
    message
  }: { tenant: string, message: RecordsReadMessage }): Promise<RecordsReadReply> {

    let recordsRead: RecordsRead;
    try {
      recordsRead = await RecordsRead.parse(message);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }

    // authentication
    try {
      if (recordsRead.author !== undefined) {
        await authenticate(message.authorization!, this.didResolver);
      }
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    // get the latest active records matching the supplied filter
    // only RecordsWrite messages will be returned due to 'isLatestBaseState' being set to true.
    const query: Filter = {
      interface         : DwnInterfaceName.Records,
      isLatestBaseState : true,
      ...Records.convertFilter(message.descriptor.filter)
    };
    const existingMessages = await this.messageStore.query(tenant, query) as RecordsWriteMessage[];

    // ensure that the returned query only contains a unique record
    try {
      RecordsReadHandler.enforceSingleRecordRule(existingMessages);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }

    const newestExistingMessage = await Message.getNewestMessage(existingMessages);
    // if no record found or it has been deleted
    if (newestExistingMessage === undefined || newestExistingMessage.descriptor.method === DwnMethodName.Delete) {
      return {
        status: { code: 404, detail: 'Not Found' }
      };
    }

    const newestRecordsWrite = newestExistingMessage as RecordsWriteMessageWithOptionalEncodedData;
    try {
      await recordsRead.authorize(tenant, await RecordsWrite.parse(newestRecordsWrite), this.messageStore);
    } catch (error) {
      return messageReplyFromError(error, 401);
    }

    let data;
    if (newestRecordsWrite.encodedData !== undefined) {
      const dataBytes = Encoder.base64UrlToBytes(newestRecordsWrite.encodedData);
      data = DataStream.fromBytes(dataBytes);
      delete newestRecordsWrite.encodedData;
    } else {
      const messageCid = await Message.getCid(newestRecordsWrite);
      const result = await this.dataStore.get(tenant, messageCid, newestRecordsWrite.descriptor.dataCid);
      if (result?.dataStream === undefined) {
        return {
          status: { code: 404, detail: 'Not Found' }
        };
      }
      data = result.dataStream;
    }

    const { authorization: _, ...recordsWriteWithoutAuthorization } = newestRecordsWrite; // a trick to stripping away `authorization`
    const messageReply: RecordsReadReply ={
      status : { code: 200, detail: 'OK' },
      record : {
        ...recordsWriteWithoutAuthorization,
        data,
      }
    };
    return messageReply;
  };

  /**
   * Enforces that the supplied messages only contain a single unique logical record.
   *
   * When users read a record based on anything other than an explicit `recordId` they may get multiple results.
   * We want to make sure that the intent of which record they want to read is clear.
   * If the supplied parameters may return more than one result it will fail and signal to the user.
   *
   * @param messages a list of messages returned from the MessageStore query.
   * @throws {DwnError} when the provided messages contain more than one unique record.
   */
  private static enforceSingleRecordRule(messages: RecordsWriteMessage[]): void {
    const uniqueRecordIds: string[] = [];
    for (const { recordId } of messages) {
      if (!uniqueRecordIds.includes(recordId)) {
        uniqueRecordIds.push(recordId);
      }

      if (uniqueRecordIds.length > 1) {
        throw new DwnError(
          DwnErrorCode.RecordsReadReturnedMultiple,
          'multiple records exist for requested RecordRead parameters'
        );
      }
    }
  }
}
