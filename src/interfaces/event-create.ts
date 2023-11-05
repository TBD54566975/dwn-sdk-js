import { removeUndefinedProperties } from '../utils/object.js';
import { Time } from '../utils/time.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';

import type {
  EventDescriptor,
  EventMessageI,
  EventsCreateDescriptor,
} from '../types/event-types.js';
import { type GenericMessage, type Signer } from '../index.js';

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
        options.messageTimestamp ?? Time.getCurrentTimestamp(),
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
