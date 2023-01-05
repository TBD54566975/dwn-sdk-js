import type { MethodHandler } from '../../types.js';
import type { ProtocolsConfigureMessage } from '../types.js';

import { canonicalAuth } from '../../../core/auth.js';
import { MessageReply } from '../../../core/message-reply.js';
import { ProtocolsConfigure } from '../messages/protocols-configure.js';

import { DwnMethodName, Message } from '../../../core/message.js';

export const handleProtocolsConfigure: MethodHandler = async (
  message,
  messageStore,
  didResolver
): Promise<MessageReply> => {
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
    await canonicalAuth(protocolsConfigure, didResolver);
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
    const { author, target } = protocolsConfigure;
    const index = { author, target, ... message.descriptor };
    await messageStore.put(message, index);

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
};
