import type { MessageStore } from '../types/message-store.js';
import type { PermissionGrant } from '../protocols/permission-grant.js';
import type { EventsQueryMessage, EventsSubscribeMessage } from '../types/events-types.js';

import { GrantAuthorization } from './grant-authorization.js';
import { PermissionsProtocol } from '../protocols/permissions.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';

export class EventsGrantAuthorization {
  /**
   * Authorizes the given EventsQuery in the scope of the DID given.
   */
  public static async authorizeQueryOrSubscribe(input: {
    incomingMessage: EventsQueryMessage | EventsSubscribeMessage,
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

    // if the grant is scoped to a specific protocol, ensure that all of the query filters must include that protocol
    if (PermissionsProtocol.hasProtocolScope(permissionGrant.scope)) {
      const scopedProtocol = permissionGrant.scope.protocol;
      for (const filter of incomingMessage.descriptor.filters) {
        if (filter.protocol !== scopedProtocol) {
          throw new DwnError(
            DwnErrorCode.EventsGrantAuthorizationMismatchedProtocol,
            `The protocol ${filter.protocol} does not match the scoped protocol ${scopedProtocol}`
          );
        }
      }
    }
  }
}