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
  recordId?: string;
  // Rarely will be used.
  contextId?: string;
  messageId?: string;
  author?: string;
  // filter based on author. defaults to all
  receipient?: string;
  // filter based on targets. defaults to all.
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