import type { Signer } from '../types/signer.js';
import type { EventsGetDescriptor, EventsGetMessage } from '../types/event-types.js';

import { AbstractMessage } from '../core/abstract-message.js';
import { Message } from '../core/message.js';
import { Time } from '../utils/time.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export type EventsGetOptions = {
  watermark?: string;
  signer: Signer;
  messageTimestamp?: string;
};

export class EventsGet extends AbstractMessage<EventsGetMessage> {

  public static async parse(message: EventsGetMessage): Promise<EventsGet> {
    Message.validateJsonSchema(message);
    await Message.validateMessageSignatureIntegrity(message.authorization.signature, message.descriptor);
    Time.validateTimestamp(message.descriptor.messageTimestamp);

    return new EventsGet(message);
  }

  public static async create(options: EventsGetOptions): Promise<EventsGet> {
    const descriptor: EventsGetDescriptor = {
      interface        : DwnInterfaceName.Events,
      method           : DwnMethodName.Get,
      messageTimestamp : options.messageTimestamp ?? Time.getCurrentTimestamp(),
    };

    if (options.watermark) {
      descriptor.watermark = options.watermark;
    }

    const authorization = await Message.createAuthorization({ descriptor, signer: options.signer });
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new EventsGet(message);
  }
}