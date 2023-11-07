import type { DataStore } from '../types/data-store.js';
import type { DidResolver } from '../did/did-resolver.js';
import type { MessageStore } from '../types/message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { RecordsWriteMessageWithOptionalEncodedData } from '../types/records-types.js';
import type { MessagesGetMessage, MessagesGetReply, MessagesGetReplyEntry } from '../types/messages-types.js';

import { messageReplyFromError } from '../core/message-reply.js';
import { MessagesGet } from '../interfaces/messages-get.js';
import { authenticate, authorize } from '../core/auth.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

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
      await authorize(tenant, messagesGet);
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    const promises: Promise<MessagesGetReplyEntry>[] = [];
    const messageCids = new Set(message.descriptor.messageCids);

    for (const messageCid of messageCids) {
      const promise = this.messageStore.get(tenant, messageCid)
        .then(message => {
          return { messageCid, message };
        })
        .catch(_ => {
          return { messageCid, message: undefined, error: `Failed to get message ${messageCid}` };
        });

      promises.push(promise);
    }

    const messages = await Promise.all(promises);

    // for every message, include associated data as `encodedData` IF:
    //  * its a RecordsWrite
    //  * the data size is equal or smaller than the size threshold
    for (const entry of messages) {
      const { message } = entry;

      if (!message) {
        continue;
      }

      const { interface: messageInterface, method } = message.descriptor;
      if (messageInterface !== DwnInterfaceName.Records || method !== DwnMethodName.Write) {
        continue;
      }

      // RecordsWrite specific handling, if MessageStore has embedded `encodedData` return it with the entry.
      // we store `encodedData` along with the message if the data is below a certain threshold.
      const recordsWrite = message as RecordsWriteMessageWithOptionalEncodedData;
      if (recordsWrite.encodedData !== undefined) {
        entry.encodedData = recordsWrite.encodedData;
        delete recordsWrite.encodedData;
      }
    }

    return {
      status: { code: 200, detail: 'OK' },
      messages
    };
  }
}