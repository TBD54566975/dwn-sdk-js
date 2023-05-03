import type { DidResolver } from '../../../index.js';
import type { MethodHandler } from '../../types.js';
import type { ProtocolsConfigureMessage } from '../types.js';
import type { StorageController } from '../../../store/storage-controller.js';

import { canonicalAuth } from '../../../core/auth.js';
import { MessageReply } from '../../../core/message-reply.js';
import { ProtocolsConfigure } from '../messages/protocols-configure.js';

import { DwnInterfaceName, DwnMethodName, Message } from '../../../core/message.js';

export class ProtocolsConfigureHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private storageController: StorageController) { }

  public async handle({
    tenant,
    message,
    dataStream
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
      protocol  : message.descriptor.protocol
    };
    const existingMessages = await this.storageController.queryMessages(tenant, query) as ProtocolsConfigureMessage[];

    // find lexicographically the largest message, and if the incoming message is the largest
    let newestMessage = await Message.getMessageWithLargestCid(existingMessages);
    let incomingMessageIsNewest = false;
    if (newestMessage === undefined || await Message.isCidLarger(message, newestMessage)) {
      incomingMessageIsNewest = true;
      newestMessage = message;
    }

    // write the incoming message to DB if incoming message is newest
    let messageReply: MessageReply;
    if (incomingMessageIsNewest) {
      const { author } = protocolsConfigure;
      const indexes = {
        author,
        ... message.descriptor
      };

      // FIXME: indexes, Property 'dataSize' is incompatible with index signature.
      // Type 'number' is not assignable to type 'string'.
      await this.storageController.putWithData(tenant, message, indexes as any, dataStream);

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
      if (await Message.isCidLarger(newestMessage, message)) {
        const messageCid = await Message.getCid(message);
        deletedMessageCids.push(messageCid);

        await this.storageController.deleteMessage(tenant, message);
      }
    }

    await this.storageController.deleteEvents(tenant, deletedMessageCids);

    return messageReply;
  };
}