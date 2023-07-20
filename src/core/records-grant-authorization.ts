import type { MessageStore } from '../types/message-store.js';
import type { RecordsDelete } from '../interfaces/records-delete.js';
import type { RecordsPermissionScope } from '../types/permissions-types.js';
import type { RecordsRead } from '../interfaces/records-read.js';
import type { RecordsWrite } from '../interfaces/records-write.js';

import { DwnMethodName } from './message.js';
import { GrantAuthorization } from './grant-authorization.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';

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

    // if recordIds, authorizeRecordIds
    if (grantScope.recordIds !== undefined) {
      const recordId = RecordsGrantAuthorization.getRecordId(incomingMessage);
      if (!grantScope.recordIds.includes(recordId)) {
        throw new DwnError(
          DwnErrorCode.RecordsGrantAuthorizationRecordIds,
          `PermissionsGrant recordIds scope does not include recordId ${recordId}`
        );
      }
    } else {
      // scope has no restrictions beyond interface and method. Message is authorized to access any record.
    }
  }

  private static getRecordId(incomingMessage: RecordsRead | RecordsWrite | RecordsDelete): string {
    if (incomingMessage.message.descriptor.method === DwnMethodName.Write) {
      return (incomingMessage as RecordsWrite).message.recordId;
    } else {
      return (incomingMessage as RecordsRead | RecordsDelete).message.descriptor.recordId;
    }
  }
}