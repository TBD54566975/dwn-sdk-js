import type { BaseMessage } from './message-types.js';
import type { BaseMessageReply } from '../core/message-reply.js';
import type { Event } from './event-log.js';
import type { DwnInterfaceName, DwnMethodName } from '../core/message.js';

export type EventsGetDescriptor = {
  interface : DwnInterfaceName.Events;
  method: DwnMethodName.Get;
  watermark?: string;
};

export type EventsGetMessage = BaseMessage & {
  descriptor: EventsGetDescriptor;
};

export type EventsGetReply = BaseMessageReply & {
  events?: Event[];
};