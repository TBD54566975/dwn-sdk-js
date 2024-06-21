import type { DataStore } from '../types/data-store.js';
import type { DidResolver } from '@web5/dids';
import type { GenericMessage } from '../types/message-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { RecordsQueryReplyEntry } from '../types/records-types.js';
import type { MessagesGetMessage, MessagesGetReply, MessagesGetReplyEntry } from '../types/messages-types.js';

import { authenticate } from '../core/auth.js';
import { DataStream } from '../utils/data-stream.js';
import { Encoder } from '../utils/encoder.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { MessagesGet } from '../interfaces/messages-get.js';
import { MessagesGrantAuthorization } from '../core/messages-grant-authorization.js';
import { PermissionsProtocol } from '../protocols/permissions.js';
import { Records } from '../utils/records.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

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
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    const messageResult = await this.messageStore.get(tenant, message.descriptor.messageCid);
    if (messageResult === undefined) {
      return { status: { code: 404, detail: 'Not Found' } };
    }

    try {
      await MessagesGetHandler.authorizeMessagesGet(tenant, messagesGet, messageResult, this.messageStore);
    } catch (error) {
      return messageReplyFromError(error, 401);
    }

    // Include associated data as `encodedData` IF:
    //  * its a RecordsWrite
    //  * `encodedData` exists which means the data size is equal or smaller than the size threshold
    const entry: MessagesGetReplyEntry = { message: messageResult, messageCid: message.descriptor.messageCid };
    if (Records.isRecordsWrite(messageResult)) {
      const recordsWrite = entry.message as RecordsQueryReplyEntry;
      // RecordsWrite specific handling, if MessageStore has embedded `encodedData` return it with the entry.
      // we store `encodedData` along with the message if the data is below a certain threshold.
      if (recordsWrite.encodedData !== undefined) {
        const dataBytes = Encoder.base64UrlToBytes(recordsWrite.encodedData);
        entry.message.data = DataStream.fromBytes(dataBytes);
        delete recordsWrite.encodedData;
      } else {
        // check the data store for the associated data
        const result = await this.dataStore.get(tenant, recordsWrite.recordId, recordsWrite.descriptor.dataCid);
        if (result?.dataStream !== undefined) {
          entry.message.data = result.dataStream;
        } else {
          // if there is no data, return with the data property undefined
          delete entry.message.data;
        }
      }
    }

    return {
      status: { code: 200, detail: 'OK' },
      entry
    };
  }

  /**
   * @param messageStore Used to check if the grant has been revoked.
   */
  private static async authorizeMessagesGet(
    tenant: string,
    messagesGet: MessagesGet,
    matchedMessage: GenericMessage,
    messageStore: MessageStore
  ): Promise<void> {

    if (messagesGet.author === tenant) {
      // If the author is the tenant, no further authorization is needed
      return;
    } if (messagesGet.author !== undefined && messagesGet.signaturePayload!.permissionGrantId !== undefined) {
      // if the author is not the tenant and the message has a permissionGrantId, we need to authorize the grant
      const permissionGrant = await PermissionsProtocol.fetchGrant(tenant, messageStore, messagesGet.signaturePayload!.permissionGrantId);
      await MessagesGrantAuthorization.authorizeMessagesGetGrant({
        messagesGetMessage : messagesGet.message,
        messageToGet       : matchedMessage,
        expectedGrantor    : tenant,
        expectedGrantee    : messagesGet.author,
        permissionGrant,
        messageStore
      });
    } else {
      throw new DwnError(DwnErrorCode.MessagesGetAuthorizationFailed, 'protocol message failed authorization');
    }
  }
}