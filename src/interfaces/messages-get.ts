import type { Signer } from '../types/signer.js';
import type { MessagesGetDescriptor, MessagesGetMessage } from '../types/messages-types.js';

import { AbstractMessage } from '../core/abstract-message.js';
import { Cid } from '../utils/cid.js';
import { Message } from '../core/message.js';
import { Time } from '../utils/time.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export type MessagesGetOptions = {
  messageCid: string;
  signer: Signer;
  messageTimestamp?: string;
  permissionGrantId?: string;
};

export class MessagesGet extends AbstractMessage<MessagesGetMessage> {
  public static async parse(message: MessagesGetMessage): Promise<MessagesGet> {
    Message.validateJsonSchema(message);
    this.validateMessageCid(message.descriptor.messageCid);

    await Message.validateSignatureStructure(message.authorization.signature, message.descriptor);
    Time.validateTimestamp(message.descriptor.messageTimestamp);

    return new MessagesGet(message);
  }

  public static async create(options: MessagesGetOptions): Promise<MessagesGet> {
    const descriptor: MessagesGetDescriptor = {
      interface        : DwnInterfaceName.Messages,
      method           : DwnMethodName.Get,
      messageCid       : options.messageCid,
      messageTimestamp : options.messageTimestamp ?? Time.getCurrentTimestamp(),
    };

    const { signer, permissionGrantId } = options;
    const authorization = await Message.createAuthorization({
      descriptor,
      signer,
      permissionGrantId,
    });
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);
    MessagesGet.validateMessageCid(options.messageCid);

    return new MessagesGet(message);
  }

  /**
   * validates the provided cid
   * @param messageCid - the cid in question
   * @throws {DwnError} if an invalid cid is found.
   */
  private static validateMessageCid(messageCid: string): void {
    try {
      Cid.parseCid(messageCid);
    } catch (_) {
      throw new DwnError(DwnErrorCode.MessagesGetInvalidCid, `${messageCid} is not a valid CID`);
    }
  }
}