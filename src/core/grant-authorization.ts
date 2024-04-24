import type { GenericMessage } from '../types/message-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { PermissionGrant } from '../protocols/permission-grant.js';

import { Message } from './message.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';

export class GrantAuthorization {

  /**
   * Performs base permissions-grant-based authorization against the given message:
   * 1. Validates the `expectedGrantor` and `expectedGrantee` values against the actual values in given permission grant.
   * 2. Verifies that the incoming message is within the allowed time frame of the grant, and the grant has not been revoked.
   * 3. Verifies that the `interface` and `method` grant scopes match the incoming message.
   *
   * NOTE: Does not validate grant `conditions` or `scope` beyond `interface` and `method`
   *
   * @param messageStore Used to check if the grant has been revoked.
   * @throws {DwnError} if validation fails
   */
  public static async performBaseValidation(input: {
    incomingMessage: GenericMessage,
    expectedGrantor: string,
    expectedGrantee: string,
    permissionGrant: PermissionGrant,
    messageStore: MessageStore,
    }): Promise<void> {
    const { incomingMessage, expectedGrantor, expectedGrantee, permissionGrant, messageStore } = input;

    const incomingMessageDescriptor = incomingMessage.descriptor;

    GrantAuthorization.verifyExpectedGrantorAndGrantee(expectedGrantor, expectedGrantee, permissionGrant);

    // verify that grant is active during incomingMessage's timestamp
    const grantedFor = expectedGrantor; // renaming for better readability now that we have verified the grantor above
    await GrantAuthorization.verifyGrantActive(
      grantedFor,
      incomingMessageDescriptor.messageTimestamp,
      permissionGrant,
      messageStore
    );

    // Check grant scope for interface and method
    await GrantAuthorization.verifyGrantScopeInterfaceAndMethod(
      incomingMessageDescriptor.interface,
      incomingMessageDescriptor.method,
      permissionGrant,
    );
  }

  /**
   * Verifies the given `expectedGrantor` and `expectedGrantee` values against
   * the actual signer and recipient in given permission grant.
   * @throws {DwnError} if `expectedGrantor` or `expectedGrantee` do not match the actual values in the grant.
   */
  private static verifyExpectedGrantorAndGrantee(
    expectedGrantor: string,
    expectedGrantee: string,
    permissionGrant: PermissionGrant
  ): void {

    const actualGrantee = permissionGrant.grantee;
    if (expectedGrantee !== actualGrantee) {
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationNotGrantedToAuthor,
        `Permission grant is granted to ${actualGrantee}, but need to be granted to ${expectedGrantee}`
      );
    }

    const actualGrantor = permissionGrant.grantor;
    if (expectedGrantor !== actualGrantor) {
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationNotGrantedForTenant,
        `Permission grant is granted by ${actualGrantor}, but need to be granted by ${expectedGrantor}`
      );
    }
  }

  /**
   * Verify that the incoming message is within the allowed time frame of the grant,
   * and the grant has not been revoked.
   * @param messageStore Used to check if the grant has been revoked.
   * @throws {DwnError} if incomingMessage has timestamp for a time in which the grant is not active.
   */
  private static async verifyGrantActive(
    grantedFor: string,
    incomingMessageTimestamp: string,
    permissionGrant: PermissionGrant,
    messageStore: MessageStore,
  ): Promise<void> {
    // Check that incomingMessage is within the grant's time frame
    if (incomingMessageTimestamp < permissionGrant.dateGranted) {
      // grant is not yet active
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationGrantNotYetActive,
        `The message has a timestamp before the associated permission grant becomes active`,
      );
    }

    if (incomingMessageTimestamp >= permissionGrant.dateExpires) {
      // grant has expired
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationGrantExpired,
        `The message has timestamp after the expiry of the associated permission grant`,
      );
    }

    // Check if grant has been revoked
    const query = {
      parentId          : permissionGrant.id,
      protocolPath      : `grant/revocation`, // NOTE: this is optional, not referencing PermissionsProtocol.revocationPath due to circular dependency
      isLatestBaseState : true
    };
    const { messages: revokes } = await messageStore.query(grantedFor, [query]);
    const oldestExistingRevoke = await Message.getOldestMessage(revokes);

    if (oldestExistingRevoke !== undefined && oldestExistingRevoke.descriptor.messageTimestamp <= incomingMessageTimestamp) {
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationGrantRevoked,
        `Permission grant with CID ${permissionGrant.id} has been revoked`,
      );
    }
  }

  /**
   * Verify that the `interface` and `method` grant scopes match the incoming message
   * @param permissionGrantId Purely being passed for logging purposes.
   * @throws {DwnError} if the `interface` and `method` of the incoming message do not match the scope of the permission grant.
   */
  private static async verifyGrantScopeInterfaceAndMethod(
    dwnInterface: string,
    dwnMethod: string,
    permissionGrant: PermissionGrant,
  ): Promise<void> {

    if (dwnInterface !== permissionGrant.scope.interface) {
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationInterfaceMismatch,
        `DWN Interface of incoming message is outside the scope of permission grant with ID ${permissionGrant.id}`
      );
    } else if (dwnMethod !== permissionGrant.scope.method) {
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationMethodMismatch,
        `DWN Method of incoming message is outside the scope of permission grant with ID ${permissionGrant.id}`
      );
    }
  }
}