import type { EventLog } from '../../../types/event-log.js';
import type { MethodHandler } from '../../../types/method-handler.js';
import type { ProtocolsConfigureMessage } from '../../../types/protocols-types.js';
import type { DataStore, DidResolver, MessageStore } from '../../../index.js';

import { canonicalAuth } from '../../../core/auth.js';
import { MessageReply } from '../../../core/message-reply.js';
import { ProtocolsConfigure } from '../messages/protocols-configure.js';
import { StorageController } from '../../../store/storage-controller.js';

import { DwnInterfaceName, DwnMethodName, Message } from '../../../core/message.js';

export class ProtocolsConfigureHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private messageStore: MessageStore, private dataStore: DataStore, private eventLog: EventLog) { }

  public async handle({
    tenant,
    message,
    dataStream: _dataStream
  }: {tenant: string, message: ProtocolsConfigureMessage, dataStream: _Readable.Readable}): Promise<MessageReply> {

    let protocolsConfigure: ProtocolsConfigure;
    try {
      protocolsConfigure = await ProtocolsConfigure.parse(message);
    } catch (e) {
      return MessageReply.fromError(e, 400);
    }

    // authentication & authorization
    try {
      await canonicalAuth(tenant, protocolsConfigure, this.didResolver);
    } catch (e) {
      return MessageReply.fromError(e, 401);
    }

    // attempt to get existing protocol
    const query = {
      interface : DwnInterfaceName.Protocols,
      method    : DwnMethodName.Configure,
      protocol  : message.descriptor.definition.protocol
    };
    const existingMessages = await this.messageStore.query(tenant, query) as ProtocolsConfigureMessage[];

    // find lexicographically the largest message, and if the incoming message is the largest
    let newestMessage = await Message.getNewestMessage(existingMessages);
    let incomingMessageIsNewest = false;
    if (newestMessage === undefined || await Message.isNewer(message, newestMessage)) {
      incomingMessageIsNewest = true;
      newestMessage = message;
    }

    // write the incoming message to DB if incoming message is newest
    let messageReply: MessageReply;
    if (incomingMessageIsNewest) {
      const indexes = ProtocolsConfigureHandler.constructProtocolsConfigureIndexes(protocolsConfigure);

      const messageCid = await Message.getCid(message);
      await this.messageStore.put(tenant, message, indexes);
      await this.eventLog.append(tenant, messageCid);

      messageReply = new MessageReply({
        status: { code: 202, detail: 'Accepted' }
      });
    } else {
      messageReply = new MessageReply({
        status: { code: 409, detail: 'Conflict' }
      });
    }

    // delete all existing records that are smaller
    const deletedMessageCids: string[] = [];
    for (const message of existingMessages) {
      if (await Message.isNewer(newestMessage, message)) {
        const messageCid = await Message.getCid(message);
        deletedMessageCids.push(messageCid);

        await StorageController.delete(this.messageStore, this.dataStore, tenant, message);
      }
    }

    await this.eventLog.deleteEventsByCid(tenant, deletedMessageCids);

    return messageReply;
  };

  private static constructProtocolsConfigureIndexes(protocolsConfigure: ProtocolsConfigure): Record<string, string> {
    // strip out `dataSize` and `definition` as they are not indexable
    // retain protocol url from `definition`
    const { dataSize, definition, ...propertiesToIndex } = protocolsConfigure.message.descriptor;
    const { author } = protocolsConfigure;

    const indexes = {
      ...propertiesToIndex,
      protocol : definition.protocol,
      author   : author!
    };

    return indexes;
  }
}