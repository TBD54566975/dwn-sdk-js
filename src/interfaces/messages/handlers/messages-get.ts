import type { DataStore } from '../../../types/data-store.js';
import type { DidResolver } from '../../../did/did-resolver.js';
import type { MessageStore } from '../../../types/message-store.js';
import type { MethodHandler } from '../../../types/method-handler.js';
import type { MessagesGetMessage, MessagesGetReply, MessagesGetReplyEntry } from '../../../types/messages-types.js';

import { DataStream } from '../../../utils/data-stream.js';
import { DwnConstant } from '../../../core/dwn-constant.js';
import { Encoder } from '../../../utils/encoder.js';
import { MessageReply } from '../../../core/message-reply.js';
import { MessagesGet } from '../messages/messages-get.js';
import { authenticate, authorize } from '../../../core/auth.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../../../core/message.js';

type HandleArgs = { tenant: string, message: MessagesGetMessage };

export class MessagesGetHandler implements MethodHandler {
  constructor(private didResolver: DidResolver, private messageStore: MessageStore, private dataStore: DataStore) {}

  public async handle({ tenant, message }: HandleArgs): Promise<MessagesGetReply> {
    let messagesGet: MessagesGet;

    try {
      messagesGet = await MessagesGet.parse(message);
    } catch (e) {
      return MessageReply.fromError(e, 400);
    }

    try {
      await authenticate(message.authorization, this.didResolver);
      await authorize(tenant, messagesGet);
    } catch (e) {
      return MessageReply.fromError(e, 401);
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
    //! NOTE: this is somewhat duplicate code that also exists in `StorageController.query`.
    for (const entry of messages) {
      const { message } = entry;

      if (!message) {
        continue;
      }

      const { interface: messageInterface, method } = message.descriptor;
      if (messageInterface !== DwnInterfaceName.Records || method !== DwnMethodName.Write) {
        continue;
      }

      const dataCid = message.descriptor.dataCid;
      const dataSize = message.descriptor.dataSize;

      if (dataCid !== undefined && dataSize! <= DwnConstant.maxDataSizeAllowedToBeEncoded) {
        const messageCid = await Message.getCid(message);
        const result = await this.dataStore.get(tenant, messageCid, dataCid);

        if (result) {
          const dataBytes = await DataStream.toBytes(result.dataStream);
          entry.encodedData = Encoder.bytesToBase64Url(dataBytes);
        }
      }
    }

    return {
      status: { code: 200, detail: 'OK' },
      messages
    };
  }
}