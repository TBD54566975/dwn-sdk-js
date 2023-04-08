import type { SignatureInput } from '../../../jose/jws/general/types.js';
import type { EventsGetDescriptor, EventsGetMessage } from '../types.js';

import { validateAuthorizationIntegrity } from '../../../core/auth.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../../../core/message.js';

export type EventsGetOptions = {
  watermark?: string;
  authorizationSignatureInput: SignatureInput;
};

export class EventsGet extends Message<EventsGetMessage> {

  public static async parse(message: EventsGetMessage): Promise<EventsGet> {
    Message.validateJsonSchema(message);
    await validateAuthorizationIntegrity(message);

    return new EventsGet(message);
  }

  public static async create(options: EventsGetOptions): Promise<EventsGet> {
    const descriptor: EventsGetDescriptor = {
      interface : DwnInterfaceName.Events,
      method    : DwnMethodName.Get,
    };

    if (options.watermark) {
      descriptor.watermark = options.watermark;
    }

    Message.validateJsonSchema({ descriptor, authorization: { } });

    const authorization = await Message.signAsAuthorization(descriptor, options.authorizationSignatureInput);
    const message = { descriptor, authorization };

    const eventsGet = new EventsGet(message);
    return eventsGet;
  }
}