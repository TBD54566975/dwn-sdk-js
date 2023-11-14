import type { GenericMessage } from '../types/message-types.js';
import type { MessageInterface } from '../types/message-interface.js';
import type { MessageStore } from '../types/message-store.js';
import type { PermissionsGrantMessage } from '../types/permissions-types.js';

import { Message } from './message.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export class GrantAuthorization {

  /**
   * Performs PermissionsGrant-based authorization against the given message
   * Does not validate grant `conditions` or `scope` beyond `interface` and `method`
   * @throws {Error} if authorization fails
   */
  public static async authorizeGenericMessage(
    tenant: string,
    incomingMessage: MessageInterface<GenericMessage>,
    author: string,
    permissionsGrantId: string,
    messageStore: MessageStore,
  ): Promise<PermissionsGrantMessage> {

    const incomingMessageDescriptor = incomingMessage.message.descriptor;

    // Fetch grant
    const permissionsGrantMessage = await GrantAuthorization.fetchGrant(tenant, messageStore, permissionsGrantId);

    GrantAuthorization.verifyGrantedToAndGrantedFor(author, tenant, permissionsGrantMessage);

    // verify that grant is active during incomingMessage's timestamp
    await GrantAuthorization.verifyGrantActive(
      tenant,
      incomingMessageDescriptor.messageTimestamp,
      permissionsGrantMessage,
      permissionsGrantId,
      messageStore
    );

    // Check grant scope for interface and method
    await GrantAuthorization.verifyGrantScopeInterfaceAndMethod(
      incomingMessageDescriptor.interface,
      incomingMessageDescriptor.method,
      permissionsGrantMessage,
      permissionsGrantId
    );

    return permissionsGrantMessage;
  }

  /**
   * Fetches PermissionsGrantMessage with CID `permissionsGrantId`.
   * @returns the PermissionsGrantMessage with CID `permissionsGrantId` if message exists
   * @throws {Error} if PermissionsGrantMessage with CID `permissionsGrantId` does not exist
   */
  private static async fetchGrant(
    tenant: string,
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
    return permissionsGrantMessage;
  }

  /**
   * Verifies the given `grantedTo` and `grantedFor` values against the given permissions grant and throws error if there is a mismatch.
   */
  private static verifyGrantedToAndGrantedFor(grantedTo: string, grantedFor: string, permissionsGrantMessage: PermissionsGrantMessage): void {
    // Validate `grantedTo`
    const expectedGrantedTo = permissionsGrantMessage.descriptor.grantedTo;
    if (expectedGrantedTo !== grantedTo) {
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationNotGrantedToAuthor,
        `PermissionsGrant has grantedTo ${expectedGrantedTo}, but given ${grantedTo}`
      );
    }

    // Validate `grantedFor`
    const expectedGrantedFor = permissionsGrantMessage.descriptor.grantedFor;
    if (expectedGrantedFor !== grantedFor) {
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationNotGrantedForTenant,
        `PermissionsGrant has grantedFor ${expectedGrantedFor}, but given ${grantedFor}`
      );
    }
  }

  /**
   * Verify that the incoming message is within the allowed time frame of the grant,
   * and the grant has not been revoked.
   * @param permissionsGrantId Purely being passed as an optimization. Technically can be computed from `permissionsGrantMessage`.
   * @throws {Error} if incomingMessage has timestamp for a time in which the grant is not active.
   */
  private static async verifyGrantActive(
    tenant: string,
    incomingMessageTimestamp: string,
    permissionsGrantMessage: PermissionsGrantMessage,
    permissionsGrantId: string,
    messageStore: MessageStore,
  ): Promise<void> {
    // Check that incomingMessage is within the grant's time frame
    if (incomingMessageTimestamp < permissionsGrantMessage.descriptor.messageTimestamp) {
      // grant is not yet active
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationGrantNotYetActive,
        `The message has a timestamp before the associated PermissionsGrant becomes active`,
      );
    } else if (incomingMessageTimestamp >= permissionsGrantMessage.descriptor.dateExpires) {
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
    const { messages: revokes } = await messageStore.query(tenant, [query]);
    const oldestExistingRevoke = await Message.getOldestMessage(revokes);

    if (oldestExistingRevoke !== undefined && oldestExistingRevoke.descriptor.messageTimestamp <= incomingMessageTimestamp) {
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
    dwnInterface: string,
    dwnMethod: string,
    permissionsGrantMessage: PermissionsGrantMessage,
    permissionsGrantId: string
  ): Promise<void> {
    if (dwnInterface !== permissionsGrantMessage.descriptor.scope.interface) {
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationInterfaceMismatch,
        `DWN Interface of incoming message is outside the scope of PermissionsGrant with CID ${permissionsGrantId}`
      );
    } else if (dwnMethod !== permissionsGrantMessage.descriptor.scope.method) {
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationMethodMismatch,
        `DWN Method of incoming message is outside the scope of PermissionsGrant with CID ${permissionsGrantId}`
      );
    }
  }
}