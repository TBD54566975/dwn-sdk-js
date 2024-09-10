import type { MessageStore } from '../types/message-store.js';
import type { PermissionGrant } from '../protocols/permission-grant.js';
import type { ProtocolPermissionScope } from '../types/permission-types.js';
import type { ProtocolsConfigureMessage, ProtocolsQueryMessage } from '../types/protocols-types.js';

import { GrantAuthorization } from './grant-authorization.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';

export class ProtocolsGrantAuthorization {
  /**
   * Authorizes the given ProtocolsConfigure in the scope of the DID given.
   */
  public static async authorizeConfigure(input: {
    protocolsConfigureMessage: ProtocolsConfigureMessage,
    expectedGrantor: string,
    expectedGrantee: string,
    permissionGrant: PermissionGrant,
    messageStore: MessageStore,
  }): Promise<void> {
    const {
      protocolsConfigureMessage, expectedGrantor, expectedGrantee, permissionGrant, messageStore
    } = input;

    await GrantAuthorization.performBaseValidation({
      incomingMessage: protocolsConfigureMessage,
      expectedGrantor,
      expectedGrantee,
      permissionGrant,
      messageStore
    });

    ProtocolsGrantAuthorization.verifyScope(protocolsConfigureMessage, permissionGrant.scope as ProtocolPermissionScope);
  }

  /**
   * Authorizes the scope of a permission grant for a ProtocolsQuery message.
   * @param messageStore Used to check if the grant has been revoked.
   */
  public static async authorizeQuery(input: {
    expectedGrantor: string,
    expectedGrantee: string,
    incomingMessage: ProtocolsQueryMessage;
    permissionGrant: PermissionGrant;
    messageStore: MessageStore;
  }): Promise<void> {
    const { expectedGrantee, expectedGrantor, incomingMessage, permissionGrant, messageStore } = input;

    await GrantAuthorization.performBaseValidation({
      incomingMessage: incomingMessage,
      expectedGrantor,
      expectedGrantee,
      permissionGrant,
      messageStore
    });

    // If the grant specifies a protocol, the query must specify the same protocol.
    const permissionScope = permissionGrant.scope as ProtocolPermissionScope;
    const protocolInGrant = permissionScope.protocol;
    const protocolInMessage = incomingMessage.descriptor.filter?.protocol;
    if (protocolInGrant !== undefined && protocolInMessage !== protocolInGrant) {
      throw new DwnError(
        DwnErrorCode.ProtocolsGrantAuthorizationQueryProtocolScopeMismatch,
        `Grant protocol scope ${protocolInGrant} does not match protocol in message ${protocolInMessage}`
      );
    }
  }

  /**
   * Verifies a ProtocolsConfigure against the scope of the given grant.
   */
  private static verifyScope(
    protocolsConfigureMessage: ProtocolsConfigureMessage,
    grantScope: ProtocolPermissionScope
  ): void {

    // if the grant scope does not specify a protocol, then it is am unrestricted grant
    if (grantScope.protocol === undefined) {
      return;
    }

    if (grantScope.protocol !== protocolsConfigureMessage.descriptor.definition.protocol) {
      throw new DwnError(
        DwnErrorCode.ProtocolsGrantAuthorizationScopeProtocolMismatch,
        `Grant scope specifies different protocol than what appears in the configure message.`
      );
    }
  }
}