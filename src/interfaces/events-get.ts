import type { Signer } from '../types/signer.js';
import type { EventsGetDescriptor, EventsGetMessage } from '../types/event-types.js';

import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { validateMessageSignatureIntegrity } from '../core/auth.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';

export type EventsGetOptions = {
  watermark?: string;
  authorizationSigner: Signer;
  messageTimestamp?: string;
};

export class EventsGet extends Message<EventsGetMessage> {

  public static async parse(message: EventsGetMessage): Promise<EventsGet> {
    Message.validateJsonSchema(message);
    await validateMessageSignatureIntegrity(message.authorization.authorSignature, message.descriptor);

    return new EventsGet(message);
  }

  public static async create(options: EventsGetOptions): Promise<EventsGet> {
    const descriptor: EventsGetDescriptor = {
      interface        : DwnInterfaceName.Events,
      method           : DwnMethodName.Get,
      messageTimestamp : options.messageTimestamp ?? getCurrentTimeInHighPrecision(),
    };

    if (options.watermark) {
      descriptor.watermark = options.watermark;
    }

    const authorization = await Message.createAuthorizationAsAuthor(descriptor, options.authorizationSigner);
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new EventsGet(message);
  }
}