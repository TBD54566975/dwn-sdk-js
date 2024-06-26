import type { MessagesFilter } from '../types/messages-types.js';
import type { Signer } from '../types/signer.js';
import type { EventsSubscribeDescriptor, EventsSubscribeMessage } from '../types/events-types.js';

import { AbstractMessage } from '../core/abstract-message.js';
import { Message } from '../core/message.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { Time } from '../utils/time.js';
import { validateProtocolUrlNormalized } from '../utils/url.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';


export type EventsSubscribeOptions = {
  signer: Signer;
  messageTimestamp?: string;
  filters?: MessagesFilter[]
  permissionGrantId?: string;
};

export class EventsSubscribe extends AbstractMessage<EventsSubscribeMessage> {
  public static async parse(message: EventsSubscribeMessage): Promise<EventsSubscribe> {
    Message.validateJsonSchema(message);
    await Message.validateSignatureStructure(message.authorization.signature, message.descriptor);

    for (const filter of message.descriptor.filters) {
      if ('protocol' in filter && filter.protocol !== undefined) {
        validateProtocolUrlNormalized(filter.protocol);
      }
    }

    Time.validateTimestamp(message.descriptor.messageTimestamp);
    return new EventsSubscribe(message);
  }

  /**
   * Creates a EventsSubscribe message.
   *
   * @throws {DwnError} if json schema validation fails.
   */
  public static async create(
    options: EventsSubscribeOptions
  ): Promise<EventsSubscribe> {
    const currentTime = Time.getCurrentTimestamp();

    const descriptor: EventsSubscribeDescriptor = {
      interface        : DwnInterfaceName.Events,
      method           : DwnMethodName.Subscribe,
      filters          : options.filters ?? [],
      messageTimestamp : options.messageTimestamp ?? currentTime,
    };

    removeUndefinedProperties(descriptor);
    const { permissionGrantId, signer } = options;
    const authorization = await Message.createAuthorization({
      descriptor,
      signer,
      permissionGrantId
    });

    const message: EventsSubscribeMessage = { descriptor, authorization };
    Message.validateJsonSchema(message);
    return new EventsSubscribe(message);
  }
}
