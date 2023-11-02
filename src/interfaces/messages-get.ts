import type { Signer } from '../types/signer.js';
import type { MessagesGetDescriptor, MessagesGetMessage } from '../types/messages-types.js';

import { Cid } from '../utils/cid.js';
import { validateMessageSignatureIntegrity } from '../core/auth.js';
import { DwnError, DwnErrorCode } from '../index.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';
import { getCurrentTimeInHighPrecision, validateTimestamp } from '../utils/time.js';

export type MessagesGetOptions = {
  messageCids: string[];
  signer: Signer;
  messageTimestamp?: string;
};

export class MessagesGet extends Message<MessagesGetMessage> {
  public static async parse(message: MessagesGetMessage): Promise<MessagesGet> {
    Message.validateJsonSchema(message);
    this.validateMessageCids(message.descriptor.messageCids);

    await validateMessageSignatureIntegrity(message.authorization.signature, message.descriptor);
    validateTimestamp(message.descriptor.messageTimestamp);

    return new MessagesGet(message);
  }

  public static async create(options: MessagesGetOptions): Promise<MessagesGet> {
    const descriptor: MessagesGetDescriptor = {
      interface        : DwnInterfaceName.Messages,
      method           : DwnMethodName.Get,
      messageCids      : options.messageCids,
      messageTimestamp : options?.messageTimestamp ?? getCurrentTimeInHighPrecision(),
    };

    const authorization = await Message.createAuthorization(descriptor, options.signer);
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