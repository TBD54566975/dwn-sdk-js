import type { MessageStore } from '../types/message-store.js';
import type { PermissionGrant } from '../protocols/permission-grant.js';
import type { ProtocolPermissionScope } from '../types/permission-types.js';
import type { ProtocolsConfigureMessage } from '../types/protocols-types.js';

import { GrantAuthorization } from './grant-authorization.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';

export class ProtocolsGrantAuthorization {
  /**
   * Authorizes the given RecordsWrite in the scope of the DID given.
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
   * Verifies a record against the scope of the given grant.
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