import type { Signer } from '../types/signer.js';
import type { EventsGetDescriptor, EventsGetMessage } from '../types/event-types.js';

import { validateMessageSignatureIntegrity } from '../core/auth.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';
import { getCurrentTimeInHighPrecision, validateTimestamp } from '../utils/time.js';

export type EventsGetOptions = {
  watermark?: string;
  signer: Signer;
  messageTimestamp?: string;
};

export class EventsGet extends Message<EventsGetMessage> {

  public static async parse(message: EventsGetMessage): Promise<EventsGet> {
    Message.validateJsonSchema(message);
    await validateMessageSignatureIntegrity(message.authorization.signature, message.descriptor);
    validateTimestamp(message.descriptor.messageTimestamp);

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

    const authorization = await Message.createAuthorization(descriptor, options.signer);
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new EventsGet(message);
  }
}