import type { MessageStore } from '../types/message-store.js';
import type { PermissionsGrantMessage } from '../types/permissions-types.js';
import type { RecordsPermissionScope } from '../types/permissions-grant-descriptor.js';
import type { RecordsQueryMessage, RecordsReadMessage, RecordsWriteMessage } from '../types/records-types.js';

import { GrantAuthorization } from './grant-authorization.js';
import { PermissionsConditionPublication } from '../types/permissions-grant-descriptor.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';

export class RecordsGrantAuthorization {
  /**
   * Authorizes the given RecordsWrite in the scope of the DID given.
   */
  public static async authorizeWrite(
    tenant: string,
    incomingMessage: RecordsWriteMessage,
    author: string,
    permissionsGrantMessage: PermissionsGrantMessage,
    messageStore: MessageStore,
  ): Promise<void> {
    await GrantAuthorization.authorizeGenericMessage({
      tenant,
      incomingMessage,
      author,
      permissionsGrantMessage,
      messageStore
    });

    RecordsGrantAuthorization.verifyScope(incomingMessage, permissionsGrantMessage);

    RecordsGrantAuthorization.verifyConditions(incomingMessage, permissionsGrantMessage);
  }

  /**
   * Authorizes the scope of a PermissionsGrant for RecordsRead.
   * @param messageStore Used to check if the grant has been revoked.
   */
  public static async authorizeRead(
    tenant: string,
    incomingMessage: RecordsReadMessage,
    newestRecordsWriteMessage: RecordsWriteMessage,
    author: string,
    permissionsGrantMessage: PermissionsGrantMessage,
    messageStore: MessageStore,
  ): Promise<void> {
    await GrantAuthorization.authorizeGenericMessage({
      tenant,
      incomingMessage,
      author,
      permissionsGrantMessage,
      messageStore
    });

    RecordsGrantAuthorization.verifyScope(newestRecordsWriteMessage, permissionsGrantMessage);
  }

  /**
   * Authorizes the scope of a PermissionsGrant for RecordsQuery.
   * @param messageStore Used to check if the grant has been revoked.
   */
  public static async authorizeQuery(
    tenant: string,
    incomingMessage: RecordsQueryMessage,
    author: string,
    permissionsGrantMessage: PermissionsGrantMessage,
    messageStore: MessageStore,
  ): Promise<void> {
    await GrantAuthorization.authorizeGenericMessage({
      tenant,
      incomingMessage,
      author,
      permissionsGrantMessage,
      messageStore
    });

    // If the grant specifies a protocol, the query must specify the same protocol.
    const protocolInGrant = (permissionsGrantMessage.descriptor.scope as RecordsPermissionScope).protocol;
    const protocolInQuery = incomingMessage.descriptor.filter.protocol;
    if (protocolInGrant !== undefined && protocolInQuery !== protocolInGrant) {
      throw new DwnError(
        DwnErrorCode.RecordsGrantAuthorizationQueryProtocolScopeMismatch,
        `Grant protocol scope ${protocolInGrant} does not match protocol in query ${protocolInQuery}`
      );
    }
  }

  /**
   * @param recordsWrite The source of the record being authorized. If the incoming message is a write,
   *                     then this is the incoming RecordsWrite. Otherwise, it is the newest existing RecordsWrite.
   */
  private static verifyScope(
    recordsWriteMessage: RecordsWriteMessage,
    permissionsGrantMessage: PermissionsGrantMessage,
  ): void {
    const grantScope = permissionsGrantMessage.descriptor.scope as RecordsPermissionScope;

    if (RecordsGrantAuthorization.isUnrestrictedScope(grantScope)) {
      // scope has no restrictions beyond interface and method. Message is authorized to access any record.
      return;
    } else if (recordsWriteMessage.descriptor.protocol !== undefined) {
      // authorization of protocol records must have grants that explicitly include the protocol
      RecordsGrantAuthorization.authorizeProtocolRecord(recordsWriteMessage, grantScope);
    } else {
      RecordsGrantAuthorization.authorizeFlatRecord(recordsWriteMessage, grantScope);
    }
  }

  /**
   * Authorizes a grant scope for a protocol record
   */
  private static authorizeProtocolRecord(
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
   * Authorizes a grant scope for a non-protocol record
   */
  private static authorizeFlatRecord(
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
