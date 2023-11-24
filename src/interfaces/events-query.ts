import type { Filter } from '../types/query-types.js';
import type { Signer } from '../types/signer.js';
import type { EventsFilter, EventsQueryDescriptor, EventsQueryMessage } from '../types/event-types.js';

import { AbstractMessage } from '../core/abstract-message.js';
import { Message } from '../core/message.js';
import { Records } from '../utils/records.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { Time } from '../utils/time.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export type EventsQueryOptions = {
  signer: Signer;
  filters: EventsFilter[];
  cursor?: string;
  messageTimestamp?: string;
};

export class EventsQuery extends AbstractMessage<EventsQueryMessage>{

  public static async parse(message: EventsQueryMessage): Promise<EventsQuery> {
    Message.validateJsonSchema(message);
    await Message.validateMessageSignatureIntegrity(message.authorization.signature, message.descriptor);

    return new EventsQuery(message);
  }

  public static async create(options: EventsQueryOptions): Promise<EventsQuery> {
    const descriptor: EventsQueryDescriptor = {
      interface        : DwnInterfaceName.Events,
      method           : DwnMethodName.Query,
      filters          : this.normalizeFilters(options.filters),
      messageTimestamp : options.messageTimestamp ?? Time.getCurrentTimestamp(),
      cursor           : options.cursor,
    };

    removeUndefinedProperties(descriptor);

    const authorization = await Message.createAuthorization({ descriptor, signer: options.signer });
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new EventsQuery(message);
  }

  private static normalizeFilters(filters: EventsFilter[]): EventsFilter[] {
    // currently all normalization filters are shared with `Records`.
    return filters.map(filter => Records.normalizeFilter(filter));
  }

  /**
   *  Converts an incoming array of EventsFilter into a Filter usable by EventLog.
   *
   * @param filters An array of EventsFilter
   * @returns {Filter[]} an array of generic Filter able to be used when querying.
   */
  public static convertFilters(filters: EventsFilter[]): Filter[] {
    //currently only the range criterion for Records need to be converted
    return filters.map(filter => Records.convertFilter(filter));
  }
}