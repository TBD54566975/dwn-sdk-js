import type { DataStore } from '../types/data-store.js';
import type { DidResolver } from '../did/did-resolver.js';
import type { Filter } from '../types/message-types.js';
import type { MessageStore } from '../types//message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { RecordsReadMessage, RecordsReadReply, RecordsWriteMessageWithOptionalEncodedData } from '../types/records-types.js';

import { authenticate } from '../core/auth.js';
import { DataStream } from '../utils/data-stream.js';
import { DwnInterfaceName } from '../enums/dwn-interface-method.js';
import { Encoder } from '../utils/encoder.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { ProtocolAuthorization } from '../core/protocol-authorization.js';
import { Records } from '../utils/records.js';
import { RecordsGrantAuthorization } from '../core/records-grant-authorization.js';
import { RecordsRead } from '../interfaces/records-read.js';
import { RecordsWrite } from '../interfaces/records-write.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

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
      await RecordsReadHandler.authorizeRecordsRead(tenant, recordsRead, await RecordsWrite.parse(newestRecordsWrite), this.messageStore);
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

  private static async authorizeRecordsRead(
    tenant: string,
    recordsRead: RecordsRead,
    newestRecordsWrite: RecordsWrite,
    messageStore: MessageStore
  ): Promise<void> {
    const { descriptor } = newestRecordsWrite.message;

    // if author is the same as the target tenant, we can directly grant access
    if (recordsRead.author === tenant) {
      return;
    } else if (descriptor.published === true) {
      // authentication is not required for published data
      return;
    } else if (recordsRead.author !== undefined && recordsRead.author === descriptor.recipient) {
      // The recipient of a message may always read it
      return;
    } else if (recordsRead.author !== undefined && recordsRead.signaturePayload!.permissionsGrantId !== undefined) {
      await RecordsGrantAuthorization.authorizeRead(tenant, recordsRead, newestRecordsWrite, recordsRead.author, messageStore);
    } else if (descriptor.protocol !== undefined) {
      await ProtocolAuthorization.authorizeRead(tenant, recordsRead, newestRecordsWrite, messageStore);
    } else {
      throw new DwnError(DwnErrorCode.RecordsReadAuthorizationFailed, 'message failed authorization');
    }
  }
}
