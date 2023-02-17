import type { MethodHandler } from '../../types.js';
import type { ProtocolsConfigureMessage } from '../types.js';

import { canonicalAuth } from '../../../core/auth.js';
import { MessageReply } from '../../../core/message-reply.js';
import { ProtocolsConfigure } from '../messages/protocols-configure.js';
import { StorageController } from '../../../store/storage-controller.js';

import { DataStore, DidResolver, MessageStore } from '../../../index.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../../../core/message.js';

export class ProtocolsConfigureHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private messageStore: MessageStore,private dataStore: DataStore) { }

  public async handle({
    tenant,
    message,
    dataStream
  }): Promise<MessageReply> {
    const incomingMessage = message as ProtocolsConfigureMessage;

    let protocolsConfigure: ProtocolsConfigure;
    try {
      protocolsConfigure = await ProtocolsConfigure.parse(incomingMessage);
    } catch (e) {
      return new MessageReply({
        status: { code: 400, detail: e.message }
      });
    }

    // authentication & authorization
    try {
      await canonicalAuth(tenant, protocolsConfigure, this.didResolver);
    } catch (e) {
      return new MessageReply({
        status: { code: 401, detail: e.message }
      });
    }

    // attempt to get existing protocol
    const query = {
      tenant,
      interface : DwnInterfaceName.Protocols,
      method    : DwnMethodName.Configure,
      protocol  : incomingMessage.descriptor.protocol
    };
    const existingMessages = await this.messageStore.query(query) as ProtocolsConfigureMessage[];

    // find lexicographically the largest message, and if the incoming message is the largest
    let newestMessage = await Message.getMessageWithLargestCid(existingMessages);
    let incomingMessageIsNewest = false;
    if (newestMessage === undefined || await Message.isCidLarger(incomingMessage, newestMessage)) {
      incomingMessageIsNewest = true;
      newestMessage = incomingMessage;
    }

    // write the incoming message to DB if incoming message is newest
    let messageReply: MessageReply;
    if (incomingMessageIsNewest) {
      const { author } = protocolsConfigure;
      const indexes = {
        tenant,
        author,
        ... message.descriptor
      };
      await StorageController.put(this.messageStore, this.dataStore, incomingMessage, indexes, dataStream);

      messageReply = new MessageReply({
        status: { code: 202, detail: 'Accepted' }
      });
    } else {
      messageReply = new MessageReply({
        status: { code: 409, detail: 'Conflict' }
      });
    }

    // delete all existing records that are smaller
    for (const message of existingMessages) {
      if (await Message.isCidLarger(newestMessage, message)) {
        const cid = await Message.getCid(message);
        await this.messageStore.delete(cid);
      }
    }

    return messageReply;
  };
}