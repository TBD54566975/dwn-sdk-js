import type { Signer } from '../types/signer.js';
import type { MessagesReadDescriptor, MessagesReadMessage } from '../types/messages-types.js';

import { AbstractMessage } from '../core/abstract-message.js';
import { Cid } from '../utils/cid.js';
import { Message } from '../core/message.js';
import { Time } from '../utils/time.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export type MessagesReadOptions = {
  messageCid: string;
  signer: Signer;
  messageTimestamp?: string;
  permissionGrantId?: string;
};

export class MessagesRead extends AbstractMessage<MessagesReadMessage> {
  public static async parse(message: MessagesReadMessage): Promise<MessagesRead> {
    Message.validateJsonSchema(message);
    this.validateMessageCid(message.descriptor.messageCid);

    await Message.validateSignatureStructure(message.authorization.signature, message.descriptor);
    Time.validateTimestamp(message.descriptor.messageTimestamp);

    return new MessagesRead(message);
  }

  public static async create(options: MessagesReadOptions): Promise<MessagesRead> {
    const descriptor: MessagesReadDescriptor = {
      interface        : DwnInterfaceName.Messages,
      method           : DwnMethodName.Read,
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
    MessagesRead.validateMessageCid(options.messageCid);

    return new MessagesRead(message);
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
      throw new DwnError(DwnErrorCode.MessagesReadInvalidCid, `${messageCid} is not a valid CID`);
    }
  }
}