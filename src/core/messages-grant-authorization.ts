import type { GenericMessage } from '../types/message-types.js';
import type { MessagesGetMessage } from '../types/messages-types.js';
import type { MessagesPermissionScope } from '../types/permission-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { PermissionGrant } from '../protocols/permission-grant.js';
import type { RecordsDeleteMessage, RecordsWriteMessage } from '../types/records-types.js';

import { GrantAuthorization } from './grant-authorization.js';
import { Message } from './message.js';
import { Records } from '../utils/records.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export class MessagesGrantAuthorization {

  /**
   * Authorizes a RecordsReadMessage using the given permission grant.
   * @param messageStore Used to check if the given grant has been revoked.
   */
  public static async authorizeMessagesGetGrant(input: {
    messagesGetMessage: MessagesGetMessage,
    messageToGet: GenericMessage,
    expectedGrantor: string,
    expectedGrantee: string,
    permissionGrant: PermissionGrant,
    messageStore: MessageStore,
  }): Promise<void> {
    const {
      messagesGetMessage, messageToGet, expectedGrantor, expectedGrantee, permissionGrant, messageStore
    } = input;

    await GrantAuthorization.performBaseValidation({
      incomingMessage: messagesGetMessage,
      expectedGrantor,
      expectedGrantee,
      permissionGrant,
      messageStore
    });

    const scope = permissionGrant.scope as MessagesPermissionScope;
    await MessagesGrantAuthorization.verifyScope(expectedGrantor, messageToGet, scope, messageStore);
  }

  /**
   * Verifies the given record against the scope of the given grant.
   */
  private static async verifyScope(
    tenant: string,
    messageToGet: GenericMessage,
    incomingScope: MessagesPermissionScope,
    messageStore: MessageStore,
  ): Promise<void> {
    if (incomingScope.protocol === undefined) {
      // if no protocol is specified in the scope, then the grant is for all records
      return;
    }

    if (messageToGet.descriptor.interface === DwnInterfaceName.Records) {
      const recordsMessage = messageToGet as RecordsWriteMessage | RecordsDeleteMessage;
      const recordsWriteMessage = Records.isRecordsWrite(recordsMessage) ? recordsMessage :
        await MessagesGrantAuthorization.getRecordsWriteMessageToAuthorize(tenant, recordsMessage, messageStore);

      if (recordsWriteMessage.descriptor.protocol === incomingScope.protocol) {
        // the record protocol matches the incoming scope protocol
        return;
      }
    }

    throw new DwnError(DwnErrorCode.MessagesGetVerifyScopeFailed, 'record message failed scope authorization');
  }

  private static async getRecordsWriteMessageToAuthorize(
    tenant: string,
    message: RecordsDeleteMessage,
    messageStore: MessageStore
  ): Promise<RecordsWriteMessage> {
    // get existing RecordsWrite messages matching the `recordId`
    const query = {
      interface : DwnInterfaceName.Records,
      method    : DwnMethodName.Write,
      recordId  : message.descriptor.recordId
    };

    const { messages: existingMessages } = await messageStore.query(tenant, [ query ]);
    const newestWrite = await Message.getNewestMessage(existingMessages);
    if (newestWrite !== undefined) {
      return newestWrite as RecordsWriteMessage;
    }

    // It shouldn't be possible to get here, as the `RecordsDeleteMessage` should always have a corresponding `RecordsWriteMessage`.
    // But we add this in for defensive programming
    throw new DwnError(DwnErrorCode.MessagesGetWriteRecordNotFound, 'record not found');
  }
}