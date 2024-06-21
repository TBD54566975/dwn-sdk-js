import type { EventsQueryMessage } from '../types/events-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { PermissionGrant } from '../protocols/permission-grant.js';

import { GrantAuthorization } from './grant-authorization.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';

export class EventsGrantAuthorization {
  /**
   * Authorizes the given EventsQuery in the scope of the DID given.
   */
  public static async authorizeQuery(input: {
    eventsQueryMessage: EventsQueryMessage,
    expectedGrantor: string,
    expectedGrantee: string,
    permissionGrant: PermissionGrant,
    messageStore: MessageStore,
  }): Promise<void> {
    const {
      eventsQueryMessage, expectedGrantor, expectedGrantee, permissionGrant, messageStore
    } = input;

    await GrantAuthorization.performBaseValidation({
      incomingMessage: eventsQueryMessage,
      expectedGrantor,
      expectedGrantee,
      permissionGrant,
      messageStore
    });

    // if the grant is scoped to a specific protocol, ensure that all of the query filters must include that protocol
    if ('protocol' in permissionGrant.scope && permissionGrant.scope.protocol !== undefined) {
      const scopedProtocol = permissionGrant.scope.protocol;
      for (const filter of eventsQueryMessage.descriptor.filters) {
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