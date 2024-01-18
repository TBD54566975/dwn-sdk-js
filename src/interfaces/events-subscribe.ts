import type { Signer } from '../types/signer.js';
import type { EventsFilter, EventsSubscribeDescriptor, EventsSubscribeMessage } from '../types/events-types.js';

import { AbstractMessage } from '../core/abstract-message.js';
import { Message } from '../core/message.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { Time } from '../utils/time.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';
import { validateProtocolUrlNormalized, validateSchemaUrlNormalized } from '../utils/url.js';


export type EventsSubscribeOptions = {
  signer: Signer;
  messageTimestamp?: string;
  filters?: EventsFilter[]
};

export class EventsSubscribe extends AbstractMessage<EventsSubscribeMessage> {
  public static async parse(message: EventsSubscribeMessage): Promise<EventsSubscribe> {
    Message.validateJsonSchema(message);
    await Message.validateSignatureStructure(message.authorization.signature, message.descriptor);

    for (const filter of message.descriptor.filters) {
      if ('protocol' in filter && filter.protocol !== undefined) {
        validateProtocolUrlNormalized(filter.protocol);
      }
      if ('schema' in filter && filter.schema !== undefined) {
        validateSchemaUrlNormalized(filter.schema);
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

    const authorization = await Message.createAuthorization({
      descriptor,
      signer: options.signer
    });

    const message: EventsSubscribeMessage = { descriptor, authorization };
    Message.validateJsonSchema(message);
    return new EventsSubscribe(message);
  }
}
