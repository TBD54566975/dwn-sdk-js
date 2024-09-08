import type { DidResolver } from '@web5/dids';
import type { EventLog } from '../types/event-log.js';
import type { EventStream } from '../types/subscriptions.js';
import type { GenericMessageReply } from '../types/message-types.js';
import type { MessageStore } from '../types//message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { ProtocolsConfigureMessage } from '../types/protocols-types.js';

import { authenticate } from '../core/auth.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { PermissionsProtocol } from '../protocols/permissions.js';
import { ProtocolsConfigure } from '../interfaces/protocols-configure.js';
import { ProtocolsGrantAuthorization } from '../core/protocols-grant-authorization.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export class ProtocolsConfigureHandler implements MethodHandler {

  constructor(
    private didResolver: DidResolver,
    private messageStore: MessageStore,
    private eventLog: EventLog,
    private eventStream?: EventStream
  ) { }

  public async handle({
    tenant,
    message,
  }: {tenant: string, message: ProtocolsConfigureMessage }): Promise<GenericMessageReply> {
    let protocolsConfigure: ProtocolsConfigure;
    try {
      protocolsConfigure = await ProtocolsConfigure.parse(message);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }

    // authentication & authorization
    try {
      await authenticate(message.authorization, this.didResolver);
      await ProtocolsConfigureHandler.authorizeProtocolsConfigure(tenant, protocolsConfigure, this.messageStore);
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    // attempt to get existing protocol
    const query = {
      interface : DwnInterfaceName.Protocols,
      method    : DwnMethodName.Configure,
      protocol  : message.descriptor.definition.protocol
    };
    const { messages: existingMessages } = await this.messageStore.query(tenant, [ query ]);

    // find newest message, and if the incoming message is the newest
    let newestMessage = await Message.getNewestMessage(existingMessages);
    let incomingMessageIsNewest = false;
    if (newestMessage === undefined || await Message.isNewer(message, newestMessage)) {
      incomingMessageIsNewest = true;
      newestMessage = message;
    }

    // write the incoming message to DB if incoming message is newest
    let messageReply: GenericMessageReply;
    if (incomingMessageIsNewest) {
      const indexes = ProtocolsConfigureHandler.constructIndexes(protocolsConfigure);

      await this.messageStore.put(tenant, message, indexes);
      const messageCid = await Message.getCid(message);
      await this.eventLog.append(tenant, messageCid, indexes);

      // only emit if the event stream is set
      if (this.eventStream !== undefined) {
        this.eventStream.emit(tenant, { message }, indexes);
      }

      messageReply = {
        status: { code: 202, detail: 'Accepted' }
      };
    } else {
      messageReply = {
        status: { code: 409, detail: 'Conflict' }
      };
    }

    // delete all existing records that are smaller
    const deletedMessageCids: string[] = [];
    for (const message of existingMessages) {
      if (await Message.isNewer(newestMessage, message)) {
        const messageCid = await Message.getCid(message);
        deletedMessageCids.push(messageCid);

        await this.messageStore.delete(tenant, messageCid);
      }
    }

    await this.eventLog.deleteEventsByCid(tenant, deletedMessageCids);

    return messageReply;
  };

  static constructIndexes(protocolsConfigure: ProtocolsConfigure): { [key: string]: string | boolean } {
    // strip out `definition` as it is not indexable
    const { definition, ...propertiesToIndex } = protocolsConfigure.message.descriptor;
    const { author } = protocolsConfigure;

    const indexes: { [key: string]: string | boolean } = {
      ...propertiesToIndex,
      author    : author!,
      protocol  : definition.protocol, // retain protocol url from `definition`,
      published : definition.published // retain published state from definition
    };

    return indexes;
  }

  private static async authorizeProtocolsConfigure(tenant: string, protocolConfigure: ProtocolsConfigure, messageStore: MessageStore): Promise<void> {
    if (protocolConfigure.author === tenant) {
      return;
    }

    if (protocolConfigure.isSignedByAuthorDelegate) {
      await protocolConfigure.authorizeAuthorDelegate(messageStore);
    }

    if (protocolConfigure.author !== undefined && protocolConfigure.signaturePayload!.permissionGrantId !== undefined) {
      const permissionGrant = await PermissionsProtocol.fetchGrant(tenant, messageStore, protocolConfigure.signaturePayload!.permissionGrantId);
      await ProtocolsGrantAuthorization.authorizeConfigure({
        protocolsConfigureMessage : protocolConfigure.message,
        expectedGrantor           : tenant,
        expectedGrantee           : protocolConfigure.author,
        permissionGrant,
        messageStore
      });
    } else {
      throw new DwnError(DwnErrorCode.ProtocolsConfigureAuthorizationFailed, 'message failed authorization');
    }
  }
}