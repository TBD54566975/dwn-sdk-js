import type { MessageStore } from '../types/message-store.js';
import type { PermissionsGrantMessage } from '../types/permissions-types.js';
import type { RecordsPermissionScope } from '../types/permissions-grant-descriptor.js';
import type { RecordsRead } from '../interfaces/records-read.js';
import type { RecordsWrite } from '../interfaces/records-write.js';

import { GrantAuthorization } from './grant-authorization.js';
import { PermissionsConditionPublication } from '../types/permissions-grant-descriptor.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';

export class RecordsGrantAuthorization {
  /**
   * Authorizes the given RecordsWrite in the scope of the DID given.
   */
  public static async authorizeWrite(
    tenant: string,
    incomingMessage: RecordsWrite,
    author: string,
    messageStore: MessageStore,
  ): Promise<void> {
    const permissionsGrantMessage = await GrantAuthorization.authorizeGenericMessage(
      tenant,
      incomingMessage,
      author,
      incomingMessage.signaturePayload!.permissionsGrantId!,
      messageStore
    );

    RecordsGrantAuthorization.verifyScope(incomingMessage, permissionsGrantMessage);

    RecordsGrantAuthorization.verifyConditions(incomingMessage, permissionsGrantMessage);
  }

  /**
   * Authorizes the scope of a PermissionsGrant for RecordsRead.
   */
  public static async authorizeRead(
    tenant: string,
    incomingMessage: RecordsRead,
    newestRecordsWrite: RecordsWrite,
    author: string,
    messageStore: MessageStore,
  ): Promise<void> {
    const permissionsGrantMessage = await GrantAuthorization.authorizeGenericMessage(
      tenant,
      incomingMessage,
      author,
      incomingMessage.signaturePayload!.permissionsGrantId!,
      messageStore
    );

    RecordsGrantAuthorization.verifyScope(newestRecordsWrite, permissionsGrantMessage);
  }

  /**
   * @param recordsWrite The source of the record being authorized. If the incoming message is a write,
   *                     then this is the incoming RecordsWrite. Otherwise, it is the newest existing RecordsWrite.
   */
  private static verifyScope(
    recordsWrite: RecordsWrite,
    permissionsGrantMessage: PermissionsGrantMessage,
  ): void {
    const grantScope = permissionsGrantMessage.descriptor.scope as RecordsPermissionScope;

    if (RecordsGrantAuthorization.isUnrestrictedScope(grantScope)) {
      // scope has no restrictions beyond interface and method. Message is authorized to access any record.
      return;
    } else if (recordsWrite.message.descriptor.protocol !== undefined) {
      // authorization of protocol records must have grants that explicitly include the protocol
      RecordsGrantAuthorization.authorizeProtocolRecord(recordsWrite, grantScope);
    } else {
      RecordsGrantAuthorization.authorizeFlatRecord(recordsWrite, grantScope);
    }
  }

  /**
   * Authorizes a grant scope for a protocol record
   */
  private static authorizeProtocolRecord(
    recordsWrite: RecordsWrite,
    grantScope: RecordsPermissionScope
  ): void {
    // Protocol records must have grants specifying the protocol
    if (grantScope.protocol === undefined) {
      throw new DwnError(
        DwnErrorCode.RecordsGrantAuthorizationScopeNotProtocol,
        'Grant for protocol record must specify protocol in its scope'
      );
    }

    // The record's protocol must match the protocol specified in the record
    if (grantScope.protocol !== recordsWrite.message.descriptor.protocol) {
      throw new DwnError(
        DwnErrorCode.RecordsGrantAuthorizationScopeProtocolMismatch,
        `Grant scope specifies different protocol than what appears in the record`
      );
    }

    // If grant specifies either contextId, check that record is that context
    if (grantScope.contextId !== undefined && grantScope.contextId !== recordsWrite.message.contextId) {
      throw new DwnError(
        DwnErrorCode.RecordsGrantAuthorizationScopeContextIdMismatch,
        `Grant scope specifies different contextId than what appears in the record`
      );
    }

    // If grant specifies protocolPath, check that record is at that protocolPath
    if (grantScope.protocolPath !== undefined && grantScope.protocolPath !== recordsWrite.message.descriptor.protocolPath) {
      throw new DwnError(
        DwnErrorCode.RecordsGrantAuthorizationScopeProtocolPathMismatch,
        `Grant scope specifies different protocolPath than what appears in the record`
      );
    }
  }

  /**
   * Authorizes a grant scope for a non-protocol record
   */
  private static authorizeFlatRecord(
    recordsWrite: RecordsWrite,
    grantScope: RecordsPermissionScope
  ): void {
    if (grantScope.schema !== undefined) {
      if (grantScope.schema !== recordsWrite.message.descriptor.schema) {
        throw new DwnError(
          DwnErrorCode.RecordsGrantAuthorizationScopeSchema,
          `Record does not have schema in PermissionsGrant scope with schema '${grantScope.schema}'`
        );
      }
    }
  }

  /**
   * Verifies grant `conditions`.
   * Currently the only condition is `published` which only applies to RecordsWrites
   */
  private static verifyConditions(incomingMessage: RecordsWrite, permissionsGrantMessage: PermissionsGrantMessage): void {
    const conditions = permissionsGrantMessage.descriptor.conditions;

    // If conditions require publication, RecordsWrite must have `published` === true
    if (conditions?.publication === PermissionsConditionPublication.Required && !incomingMessage.message.descriptor.published) {
      throw new DwnError(
        DwnErrorCode.RecordsGrantAuthorizationConditionPublicationRequired,
        'PermissionsGrant requires message to be published'
      );
    }

    // if conditions prohibit publication, RecordsWrite must have published === false or undefined
    if (conditions?.publication === PermissionsConditionPublication.Prohibited && incomingMessage.message.descriptor.published) {
      throw new DwnError(
        DwnErrorCode.RecordsGrantAuthorizationConditionPublicationProhibited,
        'PermissionsGrant prohibits message from being published'
      );
    }
  }

  /**
   * Checks if scope has no restrictions beyond interface and method.
   * Grant-holder is authorized to access any record.
   */
  private static isUnrestrictedScope(grantScope: RecordsPermissionScope): boolean {
    return grantScope.protocol === undefined &&
           grantScope.schema === undefined;
  }
}
