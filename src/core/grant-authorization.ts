import type { GenericMessage } from '../types/message-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { PermissionsGrantMessage } from '../types/permissions-types.js';

import { DwnError, DwnErrorCode } from './dwn-error.js';
import { DwnInterfaceName, DwnMethodName, Message } from './message.js';

export class GrantAuthorization {

  /**
   * Performs PermissionsGrant-based authorization against the given message
   * Does not validate grant `conditions` or `scope` beyond `interface` and `method`
   * @throws {Error} if authorization fails
   */
  public static async authorizeGenericMessage(
    tenant: string,
    incomingMessage: Message<GenericMessage>,
    author: string,
    messageStore: MessageStore,
  ): Promise<void> {
    const permissionsGrantId: string = incomingMessage.authorizationPayload!.permissionsGrantId!;

    // Fetch grant
    const permissionsGrantMessage = await GrantAuthorization.fetchGrant(tenant, author, messageStore, permissionsGrantId);

    // verify that grant is active during incomingMessage's timestamp
    await GrantAuthorization.verifyGrantActive(
      tenant,
      incomingMessage.message,
      permissionsGrantMessage,
      permissionsGrantId,
      messageStore
    );

    // Check grant scope for interface and method
    await GrantAuthorization.verifyGrantScopeInterfaceAndMethod(incomingMessage.message, permissionsGrantMessage, permissionsGrantId);
  }

  /**
   * Fetches PermissionsGrantMessage with CID `permissionsGrantId`, and validates that message author may use the grant
   * for this tenant.
   * @returns the PermissionsGrantMessage with CID `permissionsGrantId` if message exists
   * @throws {Error} if PermissionsGrantMessage with CID `permissionsGrantId` does not exist
   */
  private static async fetchGrant(
    tenant: string,
    author: string,
    messageStore: MessageStore,
    permissionsGrantId: string,
  ): Promise<PermissionsGrantMessage> {
    const possibleGrantMessage: GenericMessage | undefined = await messageStore.get(tenant, permissionsGrantId);

    const dwnInterface = possibleGrantMessage?.descriptor.interface;
    const dwnMethod = possibleGrantMessage?.descriptor.method;
    if (possibleGrantMessage === undefined || dwnInterface !== DwnInterfaceName.Permissions || dwnMethod !== DwnMethodName.Grant) {
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationGrantMissing,
        `Could not find PermissionsGrant with CID ${permissionsGrantId}`
      );
    }

    const permissionsGrantMessage = possibleGrantMessage as PermissionsGrantMessage;

    // Validate `grantedTo`
    if (permissionsGrantMessage.descriptor.grantedTo !== author) {
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationNotGrantedToAuthor,
        `PermissionsGrant with CID ${permissionsGrantId} is not granted to ${author}`
      );
    }

    // Validate `grantedFor`
    if (permissionsGrantMessage.descriptor.grantedFor !== tenant) {
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationNotGrantedForTenant,
        `PermissionsGrant with CID ${permissionsGrantId} is not granted for DWN belonging to ${tenant}`
      );
    }

    return permissionsGrantMessage;
  }

  /**
   * Verify that the incoming message is within the allowed time frame of the grant,
   * and the grant has not been revoked.
   * @throws {Error} if incomingMessage has timestamp for a time in which the grant is not active.
   */
  public static async verifyGrantActive(
    tenant: string,
    incomingMessage: GenericMessage,
    permissionsGrantMessage: PermissionsGrantMessage,
    permissionsGrantId: string,
    messageStore: MessageStore,
  ): Promise<void> {
    // Check that incomingMessage is within the grant's timeframe
    if (incomingMessage.descriptor.messageTimestamp < permissionsGrantMessage.descriptor.messageTimestamp) {
      // grant is not yet active
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationGrantNotYetActive,
        `The message has a timestamp before the associated PermissionsGrant becomes active`,
      );
    } else if (incomingMessage.descriptor.messageTimestamp >= permissionsGrantMessage.descriptor.dateExpires) {
      // grant has expired
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationGrantExpired,
        `The message has timestamp after the expiry of the associated PermissionsGrant`,
      );
    }

    // Check if grant has been revoked
    const query = {
      interface : DwnInterfaceName.Permissions,
      method    : DwnMethodName.Revoke,
      permissionsGrantId,
    };
    const revokes = await messageStore.query(tenant, query);
    const oldestExistingRevoke = await Message.getOldestMessage(revokes);

    if (oldestExistingRevoke !== undefined && oldestExistingRevoke.descriptor.messageTimestamp <= incomingMessage.descriptor.messageTimestamp) {
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationGrantRevoked,
        `PermissionsGrant with CID ${permissionsGrantId} has been revoked`,
      );
    }
  }

  /**
   * Verify that the `interface` and `method` grant scopes match the incoming message
   * @throws {Error} if the `interface` and `method` of the incoming message do not match the scope of the PermissionsGrant
   */
  private static async verifyGrantScopeInterfaceAndMethod(
    incomingMessage: GenericMessage,
    permissionsGrantMessage: PermissionsGrantMessage,
    permissionsGrantId: string
  ): Promise<void> {
    if (incomingMessage.descriptor.interface !== permissionsGrantMessage.descriptor.scope.interface) {
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationInterfaceMismatch,
        `DWN Interface of incoming message is outside the scope of PermissionsGrant with CID ${permissionsGrantId}`
      );
    } else if (incomingMessage.descriptor.method !== permissionsGrantMessage.descriptor.scope.method) {
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationMethodMismatch,
        `DWN Method of incoming message is outside the scope of PermissionsGrant with CID ${permissionsGrantId}`
      );
    }
  }
}