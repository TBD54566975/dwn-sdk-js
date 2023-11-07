import type { DidResolver } from '../did/did-resolver.js';
import type { EventLog } from '../types/event-log.js';
import type { GenericMessageReply } from '../core/message-reply.js';
import type { MessageStore } from '../types/message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { PermissionsGrantMessage, PermissionsRevokeMessage } from '../types/permissions-types.js';

import { authenticate } from '../core/auth.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { PermissionsRevoke } from '../interfaces/permissions-revoke.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export class PermissionsRevokeHandler implements MethodHandler {
  constructor(private didResolver: DidResolver, private messageStore: MessageStore, private eventLog: EventLog) { }

  public async handle({
    tenant,
    message
  }: { tenant: string, message: PermissionsRevokeMessage }): Promise<GenericMessageReply> {
    let permissionsRevoke: PermissionsRevoke;
    try {
      permissionsRevoke = await PermissionsRevoke.parse(message);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }


    // Authentication
    try {
      await authenticate(message.authorization, this.didResolver);
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    // Authorization
    const permissionsGrantId = message.descriptor.permissionsGrantId;
    const permissionsGrantMessage = await this.messageStore.get(
      tenant,
      permissionsGrantId
    ) as PermissionsGrantMessage | undefined;

    if (permissionsGrantMessage === undefined) {
      return {
        status: {
          code   : 400,
          detail : `Could not find PermissionsGrant with CID ${permissionsGrantId}`
        }
      };
    }

    try {
      await permissionsRevoke.authorize(permissionsGrantMessage);
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    // Revoke must have `dateCreated` after that of the grant
    if (message.descriptor.messageTimestamp < permissionsGrantMessage.descriptor.messageTimestamp) {
      return {
        status: { code: 400, detail: 'PermissionsRevoke has earlier date than associated PermissionsGrant' }
      };
    }

    // query for previous revocations of this grant
    const query = {
      interface : DwnInterfaceName.Permissions,
      method    : DwnMethodName.Revoke,
      permissionsGrantId,
    };
    const { messages: existingRevokesForGrant } = await this.messageStore.query(tenant, [ query ]);

    // Conflict 409 if the grant already has an older revoke
    const oldestExistingRevoke = await Message.getOldestMessage(existingRevokesForGrant);
    if (oldestExistingRevoke !== undefined) {
      if (await Message.isOlder(message, oldestExistingRevoke)) {
        // incoming revoke is older then existing revoke, proceed
      } else {
        // existing revoke is older then incoming revoke, ignore incoming
        return {
          status: { code: 409, detail: 'Conflict' }
        };
      }
    }

    // Store incoming PermissionsRevoke
    const indexes: { [key: string]: string } = {
      interface          : DwnInterfaceName.Permissions,
      method             : DwnMethodName.Revoke,
      permissionsGrantId : message.descriptor.permissionsGrantId,
    };
    await this.messageStore.put(tenant, message, indexes);
    await this.eventLog.append(tenant, await Message.getCid(message));

    // Delete existing revokes which are all newer than the incoming message
    const removedRevokeCids: string[] = [];
    for (const existingRevoke of existingRevokesForGrant) {
      const existingRevokeCid = await Message.getCid(existingRevoke);
      await this.messageStore.delete(tenant, existingRevokeCid);
      removedRevokeCids.push(existingRevokeCid);
    }
    await this.eventLog.deleteEventsByCid(tenant, removedRevokeCids);

    // Delete grant-authorized messages with timestamp after revocation
    const grantAuthdMessagesQuery = {
      permissionsGrantId,
      dateCreated: { gte: message.descriptor.messageTimestamp },
    };
    const { messages: grantAuthdMessagesAfterRevoke } = await this.messageStore.query(tenant, [ grantAuthdMessagesQuery ]);
    const grantAuthdMessageCidsAfterRevoke: string[] = [];
    for (const grantAuthdMessage of grantAuthdMessagesAfterRevoke) {
      const messageCid = await Message.getCid(grantAuthdMessage);
      await this.messageStore.delete(tenant, messageCid);
    }
    this.eventLog.deleteEventsByCid(tenant, grantAuthdMessageCidsAfterRevoke);

    return {
      status: { code: 202, detail: 'Accepted' }
    };
  }
}