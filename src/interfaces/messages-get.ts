import type { SignatureInput } from '../types/jws-types.js';
import type { MessagesGetDescriptor, MessagesGetMessage } from '../types/messages-types.js';

import { Cid } from '../utils/cid.js';
import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { validateAuthorizationIntegrity } from '../core/auth.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';

export type MessagesGetOptions = {
  messageCids: string[];
  authorizationSignatureInput: SignatureInput;
  messageTimestamp?: string;
};

export class MessagesGet extends Message<MessagesGetMessage> {
  public static async parse(message: MessagesGetMessage): Promise<MessagesGet> {
    Message.validateJsonSchema(message);
    this.validateMessageCids(message.descriptor.messageCids);

    await validateAuthorizationIntegrity(message);

    return new MessagesGet(message);
  }

  public static async create(options: MessagesGetOptions): Promise<MessagesGet> {
    const descriptor: MessagesGetDescriptor = {
      interface        : DwnInterfaceName.Messages,
      method           : DwnMethodName.Get,
      messageCids      : options.messageCids,
      messageTimestamp : options?.messageTimestamp ?? getCurrentTimeInHighPrecision(),
    };

    const authorization = await Message.signAsAuthorization(descriptor, options.authorizationSignatureInput);
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);
    MessagesGet.validateMessageCids(options.messageCids);

    return new MessagesGet(message);
  }

  /**
   * validates the provided cids
   * @param messageCids - the cids in question
   * @throws {Error} if an invalid cid is found.
   */
  private static validateMessageCids(messageCids: string[]): void {
    for (const cid of messageCids) {
      try {
        Cid.parseCid(cid);
      } catch (_) {
        throw new Error(`${cid} is not a valid CID`);
      }
    }
  }
}