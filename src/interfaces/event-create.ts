import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { removeUndefinedProperties } from '../utils/object.js';
import type { GenericMessage, Signer } from '../index.js';

import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';
import type {
  EventDescriptor,
  EventMessageI,
  EventsCreateDescriptor,
} from '../types/event-types.js';

export type EventCreateOptions = {
  descriptor: EventDescriptor;
  messageId?: string;
  messageTimestamp?: string;
  message?: GenericMessage;
  authorizationSigner?: Signer;
};

export class EventMessage extends Message<EventMessageI<any>> {
  static async create(options: EventCreateOptions): Promise<EventMessage> {
    const descriptor: EventsCreateDescriptor = {
      interface : DwnInterfaceName.Events,
      method    : DwnMethodName.Create,
      messageTimestamp:
        options.messageTimestamp ?? getCurrentTimeInHighPrecision(),
      messageId       : options.messageId,
      eventDescriptor : options.descriptor,
    };
    removeUndefinedProperties(descriptor);

    let authorization = undefined;
    if (options.authorizationSigner !== undefined) {
      authorization = options.authorizationSigner;
    }
    //const authorization = await Message.signAuthorizationAsAuthor(descriptor, options.authorizationSigner!);
    authorization = options.message?.authorization;
    const eventMessage = { descriptor, authorization };
    Message.validateJsonSchema(eventMessage);
    // @andorsk Fix schema validation....
    return new EventMessage(eventMessage);
  }
}
