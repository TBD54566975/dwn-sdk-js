import type { DataStore } from '../types/data-store.js';
import type { DidResolver } from '../did/did-resolver.js';
import type { EventLog } from '../types/event-log.js';
import type { GenericMessageReply } from '../core/message-reply.js';
import type { MessageStore } from '../types//message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { ProtocolsConfigureMessage } from '../types/protocols-types.js';

import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { ProtocolsConfigure } from '../interfaces/protocols-configure.js';
import { authenticate, authorizeOwner } from '../core/auth.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export class ProtocolsConfigureHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private messageStore: MessageStore, private dataStore: DataStore, private eventLog: EventLog) { }

  public async handle({
    tenant,
    message,
    dataStream: _dataStream
  }: {tenant: string, message: ProtocolsConfigureMessage, dataStream: _Readable.Readable}): Promise<GenericMessageReply> {

    let protocolsConfigure: ProtocolsConfigure;
    try {
      protocolsConfigure = await ProtocolsConfigure.parse(message);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }

    // authentication & authorization
    try {
      await authenticate(message.authorization, this.didResolver);
      await authorizeOwner(tenant, protocolsConfigure);
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
      const indexes = ProtocolsConfigureHandler.constructIndexes(protocolsConfigure, true);

      const messageCid = await Message.getCid(message);
      await this.messageStore.put(tenant, message, indexes);
      await this.eventLog.append(tenant, messageCid, indexes);

      messageReply = {
        status: { code: 202, detail: 'Accepted' }
      };
    } else {
      messageReply = {
        status: { code: 409, detail: 'Conflict' }
      };
    }

    // update all existing records indexes that are smaller to latestBaseState false
    const updateIndexPromises:Promise<void>[] = [];
    for (const message of existingMessages as ProtocolsConfigureMessage[]) {
      if (await Message.isNewer(newestMessage, message)) {
        const messageCid = await Message.getCid(message);
        const olderProtocolConfigure = await ProtocolsConfigure.parse(message);
        const updatedIndexes = ProtocolsConfigureHandler.constructIndexes(olderProtocolConfigure, false);
        updateIndexPromises.push(this.messageStore.updateIndex(tenant, messageCid, updatedIndexes));
      }
    }

    await Promise.all(updateIndexPromises);

    return messageReply;
  };

  static constructIndexes(protocolsConfigure: ProtocolsConfigure, isLatestBaseState: boolean): { [key: string]: string | boolean } {
    // strip out `definition` as it is not indexable
    const { definition, ...propertiesToIndex } = protocolsConfigure.message.descriptor;
    const { author } = protocolsConfigure;

    const indexes: { [key: string]: string | boolean } = {
      ...propertiesToIndex,
      author            : author!,
      protocol          : definition.protocol, // retain protocol url from `definition`,
      published         : definition.published, // retain published state from definition
      isLatestBaseState : isLatestBaseState
    };

    return indexes;
  }
}