import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { removeUndefinedProperties } from '../utils/object.js';
import type { Signer } from '../index.js';

import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';
import type { EventDescriptor, EventMessageI, EventsCreateDescriptor } from '../types/event-types.js';

export type EventCreateOptions = {
    descriptor: EventDescriptor;
    messageId?: string;
    authorizationSignatureInput?: Signer;
    permissionsGrantId?: string;
    messageTimestamp?: string;
};

export class EventMessage extends Message<EventMessageI<any>> {

  static async create(options: EventCreateOptions): Promise<EventMessage> {
    const descriptor: EventsCreateDescriptor = {
      interface        : DwnInterfaceName.Subscriptions,
      method           : DwnMethodName.Request,
      messageTimestamp : options.messageTimestamp ?? getCurrentTimeInHighPrecision(),
      messageId        : options.messageId,
      eventDescriptor  : options.descriptor,
    };
    removeUndefinedProperties(descriptor);
    const authorization = options.authorizationSignatureInput ?
      await Message.signAsAuthorization(descriptor, options.authorizationSignatureInput) : undefined;
    const message = { descriptor: descriptor, authorization: authorization };
    // Message.validateJsonSchema(message);
    // @andorsk Fix schema validation....
    return new EventMessage(message);
  }

}