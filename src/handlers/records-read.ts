import type { MethodHandler } from '../types/method-handler.js';
import type { RecordsWriteMessageWithOptionalEncodedData } from '../store/storage-controller.js';
import type { DataStore, DidResolver, Filter, MessageStore } from '../index.js';
import type { RecordsReadMessage, RecordsReadReply } from '../types/records-types.js';

import { authenticate } from '../core/auth.js';
import { DwnInterfaceName } from '../core/message.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { Records } from '../utils/records.js';
import { RecordsRead } from '../interfaces/records-read.js';
import { RecordsWrite } from '../interfaces/records-write.js';
import { DataStream, DwnError, DwnErrorCode, Encoder } from '../index.js';

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

    // get the latest active messages matching the supplied filter
    // only RecordsWrite messages will be returned due to 'isLatestBaseState' being set to true.
    const query: Filter = {
      interface         : DwnInterfaceName.Records,
      isLatestBaseState : true,
      ...Records.convertFilter(message.descriptor.filter)
    };
    const { messages: existingMessages } = await this.messageStore.query(tenant, [ query ]);
    if (existingMessages.length === 0) {
      return {
        status: { code: 404, detail: 'Not Found' }
      };
    } else if (existingMessages.length > 1) {
      return messageReplyFromError(new DwnError(
        DwnErrorCode.RecordsReadReturnedMultiple,
        'Multiple records exist for the RecordsRead filter'
      ), 400);
    }

    const newestRecordsWrite = existingMessages[0] as RecordsWriteMessageWithOptionalEncodedData;
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

    const messageReply: RecordsReadReply = {
      status : { code: 200, detail: 'OK' },
      record : {
        ...newestRecordsWrite,
        data,
      }
    };
    return messageReply;
  };
}
