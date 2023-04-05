import type { MethodHandler } from '../../types.js';
import type { TimestampedMessage } from '../../../core/types.js';
import type { DataStore, DidResolver, MessageStore } from '../../../index.js';
import type { RecordsReadMessage, RecordsReadReply, RecordsWriteMessage } from '../types.js';

import { authenticate } from '../../../core/auth.js';
import { Message } from '../../../core/message.js';
import { MessageReply } from '../../../core/message-reply.js';
import { RecordsRead } from '../messages/records-read.js';
import { RecordsWrite } from '../messages/records-write.js';
import { DwnInterfaceName, DwnMethodName } from '../../../core/message.js';

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
      return MessageReply.fromError(e, 400);
    }

    // authentication
    try {
      if (recordsRead.author !== undefined) {
        await authenticate(message.authorization!, this.didResolver);
      }
    } catch (e) {
      return MessageReply.fromError(e, 401);
    }

    // get existing messages matching `recordId` so we can perform authorization
    const query = {
      interface : DwnInterfaceName.Records,
      recordId  : message.descriptor.recordId
    };
    const existingMessages = await this.messageStore.query(tenant, query) as TimestampedMessage[];

    const newestExistingMessage = await RecordsWrite.getNewestMessage(existingMessages);

    // if no record found or it has been deleted
    if (newestExistingMessage === undefined || newestExistingMessage.descriptor.method === DwnMethodName.Delete) {
      return new MessageReply({
        status: { code: 404, detail: 'Not Found' }
      });
    }

    // custom authorization logic
    const newestRecordsWrite = newestExistingMessage as RecordsWriteMessage;
    if (newestRecordsWrite.descriptor.published === true) {
      // access granted
      // NOTE we check for `true` as a defensive equality comparison, so we don't mistakenly assume a record that is not published as published.
    } else {
      try {
        await recordsRead.authorize(tenant);
      } catch (error) {
        return MessageReply.fromError(error, 401);
      }
    }

    const messageCid = await Message.getCid(newestRecordsWrite);
    const result = await this.dataStore.get(tenant, messageCid, newestRecordsWrite.descriptor.dataCid);

    if (result?.dataStream === undefined) {
      return new MessageReply({
        status: { code: 404, detail: 'Not Found' }
      });
    }

    const { authorization: _, ...recordsWriteWithoutAuthorization } = newestRecordsWrite; // a trick to stripping away `authorization`
    const messageReply: RecordsReadReply ={
      status : { code: 200, detail: 'OK' },
      record : {
        ...recordsWriteWithoutAuthorization,
        data: result.dataStream
      }
    };
    return messageReply;
  };
}