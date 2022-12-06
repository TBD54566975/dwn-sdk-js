import type { MethodHandler } from '../../types';
import type { ProtocolsConfigureMessage } from '../types';

import { canonicalAuth } from '../../../core/auth';
import { DwnMethodName } from '../../../core/message';
import { ProtocolsConfigure } from '../messages/protocols-configure';
import { Message, MessageReply } from '../../../core';

export const handleProtocolsConfigure: MethodHandler = async (
  message,
  messageStore,
  didResolver
): Promise<MessageReply> => {
  try {
    const incomingMessage = message as ProtocolsConfigureMessage;
    const protocolsConfigure = await ProtocolsConfigure.parse(incomingMessage);
    const { author, target } = protocolsConfigure;

    // authentication & authorization
    try {
      await canonicalAuth(protocolsConfigure, didResolver, messageStore);
    } catch (e) {
      return new MessageReply({
        status: { code: 401, detail: e.message }
      });
    }

    // attempt to get existing protocol
    const query = {
      target   : protocolsConfigure.target,
      method   : DwnMethodName.ProtocolsConfigure,
      protocol : incomingMessage.descriptor.protocol
    };
    const existingMessages = await messageStore.query(query) as ProtocolsConfigureMessage[];

    // find lexicographically the largest message, and if the incoming message is the largest
    let newestMessage = await Message.getMessageWithLargestCid(existingMessages);
    let incomingMessageIsNewest = false;
    if (newestMessage === undefined || await Message.isCidLarger(incomingMessage, newestMessage)) {
      incomingMessageIsNewest = true;
      newestMessage = incomingMessage;
    }

    // write the incoming message to DB if incoming message is largest
    let messageReply: MessageReply;
    if (incomingMessageIsNewest) {
      await messageStore.put(message, { author, target });

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
        await messageStore.delete(cid);
      }
    }

    return messageReply;
  } catch (e) {
    return new MessageReply({
      status: { code: 500, detail: e.message }
    });
  }
};
