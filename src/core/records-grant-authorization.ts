import type { MessageStore } from '../types/message-store.js';
import type { PermissionConditions, PermissionGrantModel, RecordsPermissionScope } from '../types/permissions-grant-descriptor.js';
import type { PermissionsGrantMessage, RecordsPermissionsGrantMessage } from '../types/permissions-types.js';
import type { RecordsDeleteMessage, RecordsQueryMessage, RecordsQueryReplyEntry, RecordsReadMessage, RecordsSubscribeMessage, RecordsWriteMessage } from '../types/records-types.js';

import { Encoder } from '../utils/encoder.js';
import { GrantAuthorization } from './grant-authorization.js';
import { PermissionsConditionPublication } from '../types/permissions-grant-descriptor.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';

export class RecordsGrantAuthorization {
  /**
   * Authorizes the given RecordsWrite in the scope of the DID given.
   */
  public static async authorizeWrite(input: {
    recordsWriteMessage: RecordsWriteMessage,
    expectedGrantor: string,
    expectedGrantee: string,
    permissionsGrantMessage: RecordsWriteMessage,
    messageStore: MessageStore,
  }): Promise<void> {
    const {
      recordsWriteMessage, expectedGrantor, expectedGrantee, permissionsGrantMessage, messageStore
    } = input;

    await GrantAuthorization.performBaseValidationV2({
      incomingMessage: recordsWriteMessage,
      expectedGrantor,
      expectedGrantee,
      permissionsGrantMessage,
      messageStore
    });

    const permissionGrantEncoded = (permissionsGrantMessage as RecordsQueryReplyEntry).encodedData!;
    const permissionGrantModel = Encoder.base64UrlToObject(permissionGrantEncoded) as PermissionGrantModel;
    const permissionScope = permissionGrantModel.scope as RecordsPermissionScope;
    const permissionConditions = permissionGrantModel.conditions;

    RecordsGrantAuthorization.verifyScopeV2(recordsWriteMessage, permissionScope);

    RecordsGrantAuthorization.verifyConditions(recordsWriteMessage, permissionConditions);
  }

  /**
   * Authorizes a RecordsReadMessage using the given PermissionsGrant.
   * @param messageStore Used to check if the given grant has been revoked.
   */
  public static async authorizeRead(input: {
    recordsReadMessage: RecordsReadMessage,
    recordsWriteMessageToBeRead: RecordsWriteMessage,
    expectedGrantor: string,
    expectedGrantee: string,
    permissionsGrantMessage: RecordsWriteMessage,
    messageStore: MessageStore,
  }): Promise<void> {
    const {
      recordsReadMessage, recordsWriteMessageToBeRead, expectedGrantor, expectedGrantee, permissionsGrantMessage, messageStore
    } = input;

    await GrantAuthorization.performBaseValidationV2({
      incomingMessage: recordsReadMessage,
      expectedGrantor,
      expectedGrantee,
      permissionsGrantMessage,
      messageStore
    });

    const permissionGrantEncoded = (permissionsGrantMessage as RecordsQueryReplyEntry).encodedData!;
    const permissionGrantModel = Encoder.base64UrlToObject(permissionGrantEncoded) as PermissionGrantModel;
    const permissionScope = permissionGrantModel.scope as RecordsPermissionScope;
    RecordsGrantAuthorization.verifyScopeV2(recordsWriteMessageToBeRead, permissionScope);
  }

  /**
   * Authorizes the scope of a PermissionsGrant for RecordsQuery or RecordsSubscribe.
   * @param messageStore Used to check if the grant has been revoked.
   */
  public static async authorizeQueryOrSubscribe(input: {
    incomingMessage: RecordsQueryMessage | RecordsSubscribeMessage,
    expectedGrantor: string,
    expectedGrantee: string,
    permissionsGrantMessage: RecordsWriteMessage,
    messageStore: MessageStore,
  }): Promise<void> {
    const {
      incomingMessage, expectedGrantor, expectedGrantee, permissionsGrantMessage, messageStore
    } = input;

    await GrantAuthorization.performBaseValidationV2({
      incomingMessage,
      expectedGrantor,
      expectedGrantee,
      permissionsGrantMessage,
      messageStore
    });

    // If the grant specifies a protocol, the subscribe or query must specify the same protocol.
    const permissionGrantEncoded = (permissionsGrantMessage as RecordsQueryReplyEntry).encodedData!;
    const permissionGrantModel = Encoder.base64UrlToObject(permissionGrantEncoded) as PermissionGrantModel;
    const permissionScope = permissionGrantModel.scope as RecordsPermissionScope;
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
   * Authorizes the scope of a PermissionsGrant for RecordsDelete.
   * @param messageStore Used to check if the grant has been revoked.
   */
  public static async authorizeDelete(input: {
    recordsDeleteMessage: RecordsDeleteMessage,
    recordsWriteToDelete: RecordsWriteMessage,
    expectedGrantor: string,
    expectedGrantee: string,
    permissionsGrantMessage: RecordsWriteMessage,
    messageStore: MessageStore,
  }): Promise<void> {
    const {
      recordsDeleteMessage, recordsWriteToDelete, expectedGrantor, expectedGrantee, permissionsGrantMessage, messageStore
    } = input;

    await GrantAuthorization.performBaseValidationV2({
      incomingMessage: recordsDeleteMessage,
      expectedGrantor,
      expectedGrantee,
      permissionsGrantMessage,
      messageStore
    });

    // If the grant specifies a protocol, the delete must be deleting a record with the same protocol.
    const permissionGrantEncoded = (permissionsGrantMessage as RecordsQueryReplyEntry).encodedData!;
    const permissionGrantModel = Encoder.base64UrlToObject(permissionGrantEncoded) as PermissionGrantModel;
    const permissionScope = permissionGrantModel.scope as RecordsPermissionScope;
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
   * Verifies the given record against the scope of the given grant.
   */
  private static verifyScopeV2(
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
          `Record does not have schema in PermissionsGrant scope with schema '${grantScope.schema}'`
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
