import type { Signer } from '../types/signer.js';
import type { MessagesGetDescriptor, MessagesGetMessage } from '../types/messages-types.js';

import { AbstractMessage } from '../core/abstract-message.js';
import { Cid } from '../utils/cid.js';
import { Message } from '../core/message.js';
import { Time } from '../utils/time.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export type MessagesGetOptions = {
  messageCids: string[];
  signer: Signer;
  messageTimestamp?: string;
};

export class MessagesGet extends AbstractMessage<MessagesGetMessage> {
  public static async parse(message: MessagesGetMessage): Promise<MessagesGet> {
    Message.validateJsonSchema(message);
    this.validateMessageCids(message.descriptor.messageCids);

    await Message.validateMessageSignatureIntegrity(message.authorization.signature, message.descriptor);
    Time.validateTimestamp(message.descriptor.messageTimestamp);

    return new MessagesGet(message);
  }

  public static async create(options: MessagesGetOptions): Promise<MessagesGet> {
    const descriptor: MessagesGetDescriptor = {
      interface        : DwnInterfaceName.Messages,
      method           : DwnMethodName.Get,
      messageCids      : options.messageCids,
      messageTimestamp : options?.messageTimestamp ?? Time.getCurrentTimestamp(),
    };

    const authorization = await Message.createAuthorization({ descriptor, signer: options.signer });
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);
    MessagesGet.validateMessageCids(options.messageCids);

    return new MessagesGet(message);
  }

  /**
   * validates the provided cids
   * @param messageCids - the cids in question
   * @throws {DwnError} if an invalid cid is found.
   */
  private static validateMessageCids(messageCids: string[]): void {
    for (const cid of messageCids) {
      try {
        Cid.parseCid(cid);
      } catch (_) {
        throw new DwnError(DwnErrorCode.MessageGetInvalidCid, `${cid} is not a valid CID`);
      }
    }
  }
}