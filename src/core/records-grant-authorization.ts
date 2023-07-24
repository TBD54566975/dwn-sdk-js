import type { MessageStore } from '../types/message-store.js';
import type { RecordsDelete } from '../interfaces/records-delete.js';
import type { RecordsPermissionScope } from '../types/permissions-types.js';
import type { RecordsRead } from '../interfaces/records-read.js';
import type { RecordsWriteMessage } from '../types/records-types.js';

import { GrantAuthorization } from './grant-authorization.js';
import { RecordsWrite } from '../interfaces/records-write.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from './message.js';

export class RecordsGrantAuthorization {
  /**
   * Authorizes the scope of a PermissionsGrant for RecordsRead, RecordsWrite, and RecordsDelete messages.
   */
  public static async authorizeRecordsGrant(
    tenant: string,
    incomingMessage: RecordsRead | RecordsWrite | RecordsDelete,
    messageStore: MessageStore,
  ): Promise<void> {

    // authorize generic message
    const permissionsGrantMessage = await GrantAuthorization.authorizeGenericMessage(tenant, incomingMessage, messageStore);

    const grantScope = permissionsGrantMessage.descriptor.scope as RecordsPermissionScope;

    if (grantScope.schema !== undefined) {
      const recordsWrite = await RecordsGrantAuthorization.getRecordsWrite(tenant, incomingMessage, messageStore);
      if (grantScope.schema !== recordsWrite.message.descriptor.schema) {
        throw new DwnError(
          DwnErrorCode.RecordsGrantAuthorizationScopeSchema,
          `Record does not have schema in PermissionsGrant scope with schema '${grantScope.schema}'`
        );
      }
    } else {
      // scope has no restrictions beyond interface and method. Message is authorized to access any record.
    }
  }

  private static async getRecordsWrite(
    tenant: string,
    incomingMessage: RecordsRead | RecordsWrite | RecordsDelete,
    messageStore: MessageStore,
  ): Promise<RecordsWrite> {
    if (incomingMessage.message.descriptor.method === DwnMethodName.Write) {
      return incomingMessage as RecordsWrite;
    }

    const recordId = (incomingMessage as RecordsRead | RecordsDelete).message.descriptor.recordId;
    const query = {
      interface : DwnInterfaceName.Records,
      method    : DwnMethodName.Write,
      recordId,
    };
    const existingMessages = await messageStore.query(tenant, query);
    const recordsWriteMessage = await RecordsWrite.getNewestMessage(existingMessages) as RecordsWriteMessage;
    return RecordsWrite.parse(recordsWriteMessage);
  }
}
