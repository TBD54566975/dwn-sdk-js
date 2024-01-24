import type { MessageStore } from '../types/message-store.js';
import type { RecordsPermissionScope } from '../types/permissions-grant-descriptor.js';
import type { PermissionsGrantMessage, RecordsPermissionsGrantMessage } from '../types/permissions-types.js';
import type { RecordsDeleteMessage, RecordsQueryMessage, RecordsReadMessage, RecordsSubscribeMessage, RecordsWriteMessage } from '../types/records-types.js';

import { GrantAuthorization } from './grant-authorization.js';
import { PermissionsConditionPublication } from '../types/permissions-grant-descriptor.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';

export class RecordsGrantAuthorization {
  /**
   * Authorizes the given RecordsWrite in the scope of the DID given.
   */
  public static async authorizeWrite(input: {
    recordsWriteMessage: RecordsWriteMessage,
    expectedGrantedToInGrant: string,
    expectedGrantedForInGrant: string,
    permissionsGrantMessage: PermissionsGrantMessage,
    messageStore: MessageStore,
  }): Promise<void> {
    const {
      recordsWriteMessage, expectedGrantedToInGrant, expectedGrantedForInGrant, permissionsGrantMessage, messageStore
    } = input;

    await GrantAuthorization.performBaseValidation({
      incomingMessage: recordsWriteMessage,
      expectedGrantedToInGrant,
      expectedGrantedForInGrant,
      permissionsGrantMessage,
      messageStore
    });

    RecordsGrantAuthorization.verifyScope(recordsWriteMessage, permissionsGrantMessage as RecordsPermissionsGrantMessage);

    RecordsGrantAuthorization.verifyConditions(recordsWriteMessage, permissionsGrantMessage);
  }

  /**
   * Authorizes a RecordsReadMessage using the given PermissionsGrant.
   * @param messageStore Used to check if the given grant has been revoked.
   */
  public static async authorizeRead(input: {
    recordsReadMessage: RecordsReadMessage,
    recordsWriteMessageToBeRead: RecordsWriteMessage,
    expectedGrantedToInGrant: string,
    expectedGrantedForInGrant: string,
    permissionsGrantMessage: PermissionsGrantMessage,
    messageStore: MessageStore,
  }): Promise<void> {
    const {
      expectedGrantedForInGrant, recordsReadMessage, recordsWriteMessageToBeRead, expectedGrantedToInGrant, permissionsGrantMessage, messageStore
    } = input;

    await GrantAuthorization.performBaseValidation({
      incomingMessage: recordsReadMessage,
      expectedGrantedToInGrant,
      expectedGrantedForInGrant,
      permissionsGrantMessage,
      messageStore
    });

    RecordsGrantAuthorization.verifyScope(recordsWriteMessageToBeRead, permissionsGrantMessage as RecordsPermissionsGrantMessage);
  }

  /**
   * Authorizes the scope of a PermissionsGrant for RecordsQuery or RecordsSubscribe.
   * @param messageStore Used to check if the grant has been revoked.
   */
  public static async authorizeQueryOrSubscribe(input: {
    incomingMessage: RecordsQueryMessage | RecordsSubscribeMessage,
    expectedGrantedToInGrant: string,
    expectedGrantedForInGrant: string,
    permissionsGrantMessage: PermissionsGrantMessage,
    messageStore: MessageStore,
  }): Promise<void> {
    const {
      incomingMessage, expectedGrantedToInGrant, expectedGrantedForInGrant, permissionsGrantMessage, messageStore
    } = input;

    await GrantAuthorization.performBaseValidation({
      incomingMessage,
      expectedGrantedToInGrant,
      expectedGrantedForInGrant,
      permissionsGrantMessage,
      messageStore
    });

    // If the grant specifies a protocol, the subscribe or query must specify the same protocol.
    const protocolInGrant = (permissionsGrantMessage.descriptor.scope as RecordsPermissionScope).protocol;
    const protocolInMessage = incomingMessage.descriptor.filter.protocol;
    if (protocolInGrant !== undefined && protocolInMessage !== protocolInGrant) {
      throw new DwnError(
        DwnErrorCode.RecordsGrantAuthorizationQueryOrSubscribeProtocolScopeMismatch,
        `Grant protocol scope ${protocolInGrant} does not match protocol in message ${protocolInMessage}`
      );
    }
  }

  /**
   * Authorizes the scope of a PermissionsGrant for RecordsDelete.
   * @param messageStore Used to check if the grant has been revoked.
   */
  public static async authorizeDelete(input: {
    recordsDeleteMessage: RecordsDeleteMessage,
    recordsWriteToDelete: RecordsWriteMessage,
    expectedGrantedToInGrant: string,
    expectedGrantedForInGrant: string,
    permissionsGrantMessage: PermissionsGrantMessage,
    messageStore: MessageStore,
  }): Promise<void> {
    const {
      recordsDeleteMessage, recordsWriteToDelete, expectedGrantedToInGrant, expectedGrantedForInGrant, permissionsGrantMessage, messageStore
    } = input;

    await GrantAuthorization.performBaseValidation({
      incomingMessage: recordsDeleteMessage,
      expectedGrantedToInGrant,
      expectedGrantedForInGrant,
      permissionsGrantMessage,
      messageStore
    });

    // If the grant specifies a protocol, the delete must be deleting a record with the same protocol.
    const protocolInGrant = (permissionsGrantMessage as RecordsPermissionsGrantMessage).descriptor.scope.protocol;
    const protocolOfRecordToDelete = recordsWriteToDelete.descriptor.protocol;
    if (protocolInGrant !== undefined && protocolOfRecordToDelete !== protocolInGrant) {
      throw new DwnError(
        DwnErrorCode.RecordsGrantAuthorizationDeleteProtocolScopeMismatch,
        `Grant protocol scope ${protocolInGrant} does not match protocol in record to delete ${protocolOfRecordToDelete}`
      );
    }
  }

  /**
   * @param recordsWrite The source of the record being authorized. If the incoming message is a write,
   *                     then this is the incoming RecordsWrite. Otherwise, it is the newest existing RecordsWrite.
   */
  private static verifyScope(
    recordsWriteMessage: RecordsWriteMessage,
    permissionsGrantMessage: RecordsPermissionsGrantMessage,
  ): void {
    const grantScope = permissionsGrantMessage.descriptor.scope;
    if (RecordsGrantAuthorization.isUnrestrictedScope(grantScope)) {
      // scope has no restrictions beyond interface and method. Message is authorized to access any record.
      return;
    } else if (recordsWriteMessage.descriptor.protocol !== undefined) {
      // authorization of protocol records must have grants that explicitly include the protocol
      RecordsGrantAuthorization.verifyProtocolRecordScope(recordsWriteMessage, grantScope);
    } else {
      RecordsGrantAuthorization.verifyFlatRecordScope(recordsWriteMessage, grantScope);
    }
  }

  /**
   * Verifies a protocol record against the scope of the given grant.
   */
  private static verifyProtocolRecordScope(
    recordsWriteMessage: RecordsWriteMessage,
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
    if (grantScope.protocol !== recordsWriteMessage.descriptor.protocol) {
      throw new DwnError(
        DwnErrorCode.RecordsGrantAuthorizationScopeProtocolMismatch,
        `Grant scope specifies different protocol than what appears in the record`
      );
    }

    // If grant specifies either contextId, check that record is that context
    if (grantScope.contextId !== undefined && grantScope.contextId !== recordsWriteMessage.contextId) {
      throw new DwnError(
        DwnErrorCode.RecordsGrantAuthorizationScopeContextIdMismatch,
        `Grant scope specifies different contextId than what appears in the record`
      );
    }

    // If grant specifies protocolPath, check that record is at that protocolPath
    if (grantScope.protocolPath !== undefined && grantScope.protocolPath !== recordsWriteMessage.descriptor.protocolPath) {
      throw new DwnError(
        DwnErrorCode.RecordsGrantAuthorizationScopeProtocolPathMismatch,
        `Grant scope specifies different protocolPath than what appears in the record`
      );
    }
  }

  /**
   * Verifies a non-protocol record against the scope of the given grant.
   */
  private static verifyFlatRecordScope(
    recordsWriteMessage: RecordsWriteMessage,
    grantScope: RecordsPermissionScope
  ): void {
    if (grantScope.schema !== undefined) {
      if (grantScope.schema !== recordsWriteMessage.descriptor.schema) {
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
  private static verifyConditions(recordsWriteMessage: RecordsWriteMessage, permissionsGrantMessage: PermissionsGrantMessage): void {
    const conditions = permissionsGrantMessage.descriptor.conditions;

    // If conditions require publication, RecordsWrite must have `published` === true
    if (conditions?.publication === PermissionsConditionPublication.Required && !recordsWriteMessage.descriptor.published) {
      throw new DwnError(
        DwnErrorCode.RecordsGrantAuthorizationConditionPublicationRequired,
        'PermissionsGrant requires message to be published'
      );
    }

    // if conditions prohibit publication, RecordsWrite must have published === false or undefined
    if (conditions?.publication === PermissionsConditionPublication.Prohibited && recordsWriteMessage.descriptor.published) {
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
