import type { MethodHandler } from '../types/method-handler.js';
import type { RecordsWriteMessageWithOptionalEncodedData } from '../store/storage-controller.js';
import type { DataStore, DidResolver, MessageStore } from '../index.js';
import type { Filter, TimestampedMessage } from '../types/message-types.js';
import type { RecordsReadDescriptor, RecordsReadMessage, RecordsReadReply } from '../types/records-types.js';

import { authenticate } from '../core/auth.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { RecordsRead } from '../interfaces/records-read.js';
import { RecordsWrite } from '../interfaces/records-write.js';
import { DataStream, Encoder } from '../index.js';
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

    // get existing messages matching `recordId` or `protocol` with `protocolPath` so we can perform authorization
    const query: Filter = RecordsReadHandler.createFilter(recordsRead.message.descriptor);
    const existingMessages = await this.messageStore.query(tenant, query) as TimestampedMessage[];
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
   * Creates a filter using `recordId` in given descriptor, if not given, `protocol` & `protocolPath` are used to create the filter instead.
   * @param descriptor message descriptor with optional properties `recordId`, `protocol` and `protocolPath`
   *
   * @returns {Filter} with a Records interface as well as the appropriate filter params
   */
  public static createFilter(descriptor: RecordsReadDescriptor): Filter {
    const commonFilter: Filter = { interface: DwnInterfaceName.Records, isLatestBaseState: true };
    const { recordId, protocol, protocolPath } = descriptor;
    if (recordId !== undefined) {
      return { ...commonFilter, recordId };
    } else {
      // else protocol & protocolPath are definitely defined
      return { ...commonFilter, protocol: protocol!, protocolPath: protocolPath! };
    }
  }
}
