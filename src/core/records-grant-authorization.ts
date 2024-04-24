import type { MessageStore } from '../types/message-store.js';
import type { PermissionGrant } from '../protocols/permission-grant.js';
import type { PermissionConditions, RecordsPermissionScope } from '../types/permission-types.js';
import type { RecordsDeleteMessage, RecordsQueryMessage, RecordsReadMessage, RecordsSubscribeMessage, RecordsWriteMessage } from '../types/records-types.js';

import { GrantAuthorization } from './grant-authorization.js';
import { PermissionConditionPublication } from '../types/permission-types.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';

export class RecordsGrantAuthorization {
  /**
   * Authorizes the given RecordsWrite in the scope of the DID given.
   */
  public static async authorizeWrite(input: {
    recordsWriteMessage: RecordsWriteMessage,
    expectedGrantor: string,
    expectedGrantee: string,
    permissionGrant: PermissionGrant,
    messageStore: MessageStore,
  }): Promise<void> {
    const {
      recordsWriteMessage, expectedGrantor, expectedGrantee, permissionGrant, messageStore
    } = input;

    await GrantAuthorization.performBaseValidation({
      incomingMessage: recordsWriteMessage,
      expectedGrantor,
      expectedGrantee,
      permissionGrant,
      messageStore
    });

    // NOTE: validated the invoked permission is for Records in GrantAuthorization.performBaseValidation()
    RecordsGrantAuthorization.verifyScope(recordsWriteMessage, permissionGrant.scope as RecordsPermissionScope);

    RecordsGrantAuthorization.verifyConditions(recordsWriteMessage, permissionGrant.conditions);
  }

  /**
   * Authorizes a RecordsReadMessage using the given permission grant.
   * @param messageStore Used to check if the given grant has been revoked.
   */
  public static async authorizeRead(input: {
    recordsReadMessage: RecordsReadMessage,
    recordsWriteMessageToBeRead: RecordsWriteMessage,
    expectedGrantor: string,
    expectedGrantee: string,
    permissionGrant: PermissionGrant,
    messageStore: MessageStore,
  }): Promise<void> {
    const {
      recordsReadMessage, recordsWriteMessageToBeRead, expectedGrantor, expectedGrantee, permissionGrant, messageStore
    } = input;

    await GrantAuthorization.performBaseValidation({
      incomingMessage: recordsReadMessage,
      expectedGrantor,
      expectedGrantee,
      permissionGrant,
      messageStore
    });

    // NOTE: validated the invoked permission is for Records in GrantAuthorization.performBaseValidation()
    RecordsGrantAuthorization.verifyScope(recordsWriteMessageToBeRead, permissionGrant.scope as RecordsPermissionScope);
  }

  /**
   * Authorizes the scope of a permission grant for RecordsQuery or RecordsSubscribe.
   * @param messageStore Used to check if the grant has been revoked.
   */
  public static async authorizeQueryOrSubscribe(input: {
    incomingMessage: RecordsQueryMessage | RecordsSubscribeMessage,
    expectedGrantor: string,
    expectedGrantee: string,
    permissionGrant: PermissionGrant,
    messageStore: MessageStore,
  }): Promise<void> {
    const {
      incomingMessage, expectedGrantor, expectedGrantee, permissionGrant, messageStore
    } = input;

    await GrantAuthorization.performBaseValidation({
      incomingMessage,
      expectedGrantor,
      expectedGrantee,
      permissionGrant,
      messageStore
    });

    // If the grant specifies a protocol, the subscribe or query must specify the same protocol.
    // NOTE: validated the invoked permission is for Records in GrantAuthorization.performBaseValidation()
    const permissionScope = permissionGrant.scope as RecordsPermissionScope;
    const protocolInGrant = permissionScope.protocol;
    const protocolInMessage = incomingMessage.descriptor.filter.protocol;
    if (protocolInGrant !== undefined && protocolInMessage !== protocolInGrant) {
      throw new DwnError(
        DwnErrorCode.RecordsGrantAuthorizationQueryOrSubscribeProtocolScopeMismatch,
        `Grant protocol scope ${protocolInGrant} does not match protocol in message ${protocolInMessage}`
      );
    }
  }

  /**
   * Authorizes the scope of a permission grant for RecordsDelete.
   * @param messageStore Used to check if the grant has been revoked.
   */
  public static async authorizeDelete(input: {
    recordsDeleteMessage: RecordsDeleteMessage,
    recordsWriteToDelete: RecordsWriteMessage,
    expectedGrantor: string,
    expectedGrantee: string,
    permissionGrant: PermissionGrant,
    messageStore: MessageStore,
  }): Promise<void> {
    const {
      recordsDeleteMessage, recordsWriteToDelete, expectedGrantor, expectedGrantee, permissionGrant, messageStore
    } = input;

    await GrantAuthorization.performBaseValidation({
      incomingMessage: recordsDeleteMessage,
      expectedGrantor,
      expectedGrantee,
      permissionGrant,
      messageStore
    });

    // If the grant specifies a protocol, the delete must be deleting a record with the same protocol.
    // NOTE: validated the invoked permission is for Records in GrantAuthorization.performBaseValidation()
    const permissionScope = permissionGrant.scope as RecordsPermissionScope;
    const protocolInGrant = permissionScope.protocol;
    const protocolOfRecordToDelete = recordsWriteToDelete.descriptor.protocol;
    if (protocolInGrant !== undefined && protocolOfRecordToDelete !== protocolInGrant) {
      throw new DwnError(
        DwnErrorCode.RecordsGrantAuthorizationDeleteProtocolScopeMismatch,
        `Grant protocol scope ${protocolInGrant} does not match protocol in record to delete ${protocolOfRecordToDelete}`
      );
    }
  }

  /**
   * Verifies the given record against the scope of the given grant.
   */
  private static verifyScope(
    recordsWriteMessage: RecordsWriteMessage,
    grantScope: RecordsPermissionScope,
  ): void {
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
        DwnErrorCode.RecordsGrantAuthorizationScopeMissingProtocol,
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

    // If grant specifies a contextId, check that record falls under that contextId
    if (grantScope.contextId !== undefined) {
      if (recordsWriteMessage.contextId === undefined || !recordsWriteMessage.contextId.startsWith(grantScope.contextId)) {
        throw new DwnError(
          DwnErrorCode.RecordsGrantAuthorizationScopeContextIdMismatch,
          `Grant scope specifies different contextId than what appears in the record`
        );
      }
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
          `Record does not have schema in permission grant scope with schema '${grantScope.schema}'`
        );
      }
    }
  }

  /**
   * Verifies grant `conditions`.
   * Currently the only condition is `published` which only applies to RecordsWrites
   */
  private static verifyConditions(recordsWriteMessage: RecordsWriteMessage, conditions: PermissionConditions | undefined): void {

    // If conditions require publication, RecordsWrite must have `published` === true
    if (conditions?.publication === PermissionConditionPublication.Required && !recordsWriteMessage.descriptor.published) {
      throw new DwnError(
        DwnErrorCode.RecordsGrantAuthorizationConditionPublicationRequired,
        'Permission grant requires message to be published'
      );
    }

    // if conditions prohibit publication, RecordsWrite must have published === false or undefined
    if (conditions?.publication === PermissionConditionPublication.Prohibited && recordsWriteMessage.descriptor.published) {
      throw new DwnError(
        DwnErrorCode.RecordsGrantAuthorizationConditionPublicationProhibited,
        'Permission grant prohibits message from being published'
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
