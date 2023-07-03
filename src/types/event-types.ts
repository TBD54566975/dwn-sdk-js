import type { Event } from './event-log.js';
import type { GenericMessage } from './message-types.js';
import type { GenericMessageReply } from '../core/message-reply.js';
import type { DwnInterfaceName, DwnMethodName } from '../core/message.js';

export type EventsGetDescriptor = {
  interface : DwnInterfaceName.Events;
  method: DwnMethodName.Get;
  watermark?: string;
  messageTimestamp: string;
};

export type EventsGetMessage = GenericMessage & {
  descriptor: EventsGetDescriptor;
};

export type EventsGetReply = GenericMessageReply & {
  events?: Event[];
};