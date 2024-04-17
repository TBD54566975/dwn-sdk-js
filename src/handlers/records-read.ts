import type { DataStore } from '../types/data-store.js';
import type { DidResolver } from '@web5/dids';
import type { Filter } from '../types/query-types.js';
import type { MessageStore } from '../types//message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { RecordsQueryReplyEntry, RecordsReadMessage, RecordsReadReply } from '../types/records-types.js';

import { authenticate } from '../core/auth.js';
import { DataStream } from '../utils/data-stream.js';
import { Encoder } from '../utils/encoder.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { PermissionsProtocol } from '../protocols/permissions.js';
import { ProtocolAuthorization } from '../core/protocol-authorization.js';
import { Records } from '../utils/records.js';
import { RecordsGrantAuthorization } from '../core/records-grant-authorization.js';
import { RecordsRead } from '../interfaces/records-read.js';
import { RecordsWrite } from '../interfaces/records-write.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

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

    const matchedRecordsWrite = existingMessages[0] as RecordsQueryReplyEntry;
    try {
      await RecordsReadHandler.authorizeRecordsRead(tenant, recordsRead, await RecordsWrite.parse(matchedRecordsWrite), this.messageStore);
    } catch (error) {
      return messageReplyFromError(error, 401);
    }

    let data;
    if (matchedRecordsWrite.encodedData !== undefined) {
      const dataBytes = Encoder.base64UrlToBytes(matchedRecordsWrite.encodedData);
      data = DataStream.fromBytes(dataBytes);
      delete matchedRecordsWrite.encodedData;
    } else {
      const result = await this.dataStore.get(tenant, matchedRecordsWrite.recordId, matchedRecordsWrite.descriptor.dataCid);
      if (result?.dataStream === undefined) {
        return {
          status: { code: 404, detail: 'Not Found' }
        };
      }
      data = result.dataStream;
    }

    const record = {
      ...matchedRecordsWrite,
      data
    };

    // attach initial write if returned RecordsWrite is not initial write
    if (!await RecordsWrite.isInitialWrite(record)) {
      const initialWriteQueryResult = await this.messageStore.query(
        tenant,
        [{ recordId: record.recordId, isLatestBaseState: false, method: DwnMethodName.Write }]
      );
      const initialWrite = initialWriteQueryResult.messages[0] as RecordsQueryReplyEntry;
      delete initialWrite.encodedData; // defensive measure but technically optional because we do this when an update RecordsWrite takes place
      record.initialWrite = initialWrite;
    }

    const messageReply: RecordsReadReply = {
      status: { code: 200, detail: 'OK' },
      record
    };
    return messageReply;
  };

  /**
   * @param messageStore Used to check if the grant has been revoked.
   */
  private static async authorizeRecordsRead(
    tenant: string,
    recordsRead: RecordsRead,
    matchedRecordsWrite: RecordsWrite,
    messageStore: MessageStore
  ): Promise<void> {
    if (Message.isSignedByAuthorDelegate(recordsRead.message)) {
      await recordsRead.authorizeDelegate(matchedRecordsWrite.message, messageStore);
    }

    const { descriptor } = matchedRecordsWrite.message;

    // if author is the same as the target tenant, we can directly grant access
    if (recordsRead.author === tenant) {
      return;
    } else if (descriptor.published === true) {
      // authentication is not required for published data
      return;
    } else if (recordsRead.author !== undefined && recordsRead.author === descriptor.recipient) {
      // The recipient of a message may always read it
      return;
    } else if (recordsRead.author !== undefined && recordsRead.signaturePayload!.permissionGrantId !== undefined) {
      const permissionGrant = await PermissionsProtocol.fetchGrant(tenant, messageStore, recordsRead.signaturePayload!.permissionGrantId);
      await RecordsGrantAuthorization.authorizeRead({
        recordsReadMessage          : recordsRead.message,
        recordsWriteMessageToBeRead : matchedRecordsWrite.message,
        expectedGrantor             : tenant,
        expectedGrantee             : recordsRead.author,
        permissionGrant,
        messageStore
      });
    } else if (descriptor.protocol !== undefined) {
      await ProtocolAuthorization.authorizeRead(tenant, recordsRead, matchedRecordsWrite, messageStore);
    } else {
      throw new DwnError(DwnErrorCode.RecordsReadAuthorizationFailed, 'message failed authorization');
    }
  }
}
