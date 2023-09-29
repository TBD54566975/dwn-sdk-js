import type { Event } from './event-log.js';
import type { GenericMessageReply } from '../core/message-reply.js';
import type { RecordsFilter } from './records-types.js';
import type { AuthorizationModel, GenericMessage } from './message-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../core/message.js';

export type EventsFilter = RecordsFilter & {
  methods?: string[];
  // Default to all methods. Otherwise, explicitly subscribe to subset of methods.
  interfaces?: string[];
  // Default to all interfaces. Can be subset.
  author?: string;
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
  filter: EventsFilter;
  watermark?: string;
};

export type EventsQueryMessage = GenericMessage & {
  authorization: AuthorizationModel;
  descriptor: EventsQueryDescriptor;
};

export type EventsQueryReply = GenericMessageReply & {
  events?: Event[];
};