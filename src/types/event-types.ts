import type { Event } from './event-log.js';
import type { GenericMessageReply } from '../core/message-reply.js';
import type { RecordsFilter } from './records-types.js';
import type { AuthorizationModel, GenericMessage } from './message-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../core/message.js';

/**
 * @param method optional array of methods to filter.
 * @param interface optional array of interfaces to filter.
 * @param author optional author to filter.
 *
 * @param watermark optional watermark of the last message received from this filter.
 */
export type EventsFilter = RecordsFilter & {
  method?: string[];
  interface?: string[];
  author?: string;
  watermark?: string;
};

export type EventsGetDescriptor = {
  interface : DwnInterfaceName.Events;
  method: DwnMethodName.Get;
  watermark?: string;
  messageTimestamp: string;
};

export type EventsGetMessage = GenericMessage & {
  authorization: AuthorizationModel; // overriding `GenericMessage` with `authorization` being required
  descriptor: EventsGetDescriptor;
};

export type EventsGetReply = GenericMessageReply & {
  events?: Event[];
};

export type EventsQueryDescriptor = {
  interface: DwnInterfaceName.Events;
  method: DwnMethodName.Query;
  messageTimestamp: string;
  filters: EventsFilter[];
};

export type EventsQueryMessage = GenericMessage & {
  authorization: AuthorizationModel;
  descriptor: EventsQueryDescriptor;
};

export type EventsQueryReply = GenericMessageReply & {
  events?: Event[];
};