import type { EventsQueryMessage } from '../types/events-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { PermissionGrant } from '../protocols/permission-grant.js';

import { GrantAuthorization } from './grant-authorization.js';

export class EventsGrantAuthorization {
  /**
   * Authorizes the given EventsQuery in the scope of the DID given.
   */
  public static async authorizeQuery(input: {
    recordsWriteMessage: EventsQueryMessage,
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
  }
}