import type { DataEncodedRecordsWriteMessage } from '../types/records-types.js';
import type { DataStore } from '../types/data-store.js';
import type { DidResolver } from '@web5/dids';
import type { MessageStore } from '../types/message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { MessagesGetMessage, MessagesGetReply, MessagesGetReplyEntry } from '../types/messages-types.js';

import { DataStream } from '../utils/data-stream.js';
import { Encoder } from '../utils/encoder.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { MessagesGet } from '../interfaces/messages-get.js';
import { Records } from '../utils/records.js';
import { authenticate, authorizeOwner } from '../core/auth.js';

type HandleArgs = { tenant: string, message: MessagesGetMessage };

export class MessagesGetHandler implements MethodHandler {
  constructor(private didResolver: DidResolver, private messageStore: MessageStore, private dataStore: DataStore) {}

  public async handle({ tenant, message }: HandleArgs): Promise<MessagesGetReply> {
    let messagesGet: MessagesGet;

    try {
      messagesGet = await MessagesGet.parse(message);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }

    try {
      await authenticate(message.authorization, this.didResolver);
      await authorizeOwner(tenant, messagesGet);
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    const messageResult = await this.messageStore.get(tenant, message.descriptor.messageCid);

    if (messageResult === undefined) {
      return { status: { code: 404, detail: 'Not Found' } };
    }

    // Include associated data as `encodedData` IF:
    //  * its a RecordsWrite
    //  * `encodedData` exists which means the data size is equal or smaller than the size threshold
    const entry: MessagesGetReplyEntry = { message: messageResult, messageCid: message.descriptor.messageCid };
    if (entry.message && Records.isRecordsWrite(messageResult)) {
      const recordsWrite = entry.message as DataEncodedRecordsWriteMessage;
      // RecordsWrite specific handling, if MessageStore has embedded `encodedData` return it with the entry.
      // we store `encodedData` along with the message if the data is below a certain threshold.
      if (recordsWrite.encodedData !== undefined) {
        const dataBytes = Encoder.base64UrlToBytes(recordsWrite.encodedData);
        entry.message.data = DataStream.fromBytes(dataBytes);
        delete recordsWrite.encodedData;
      } else {
        const result = await this.dataStore.get(tenant, recordsWrite.recordId, recordsWrite.descriptor.dataCid);
        if (result?.dataStream !== undefined) {
          entry.message.data = result.dataStream;
        } else {
          delete entry.message.data; // if there is no data, return with the data property undefined
        }
      }
    }

    return {
      status: { code: 200, detail: 'OK' },
      entry
    };
  }
}