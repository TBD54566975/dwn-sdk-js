import type { Event } from './event-log.js';
import type { GenericMessageReply } from '../core/message-reply.js';
import type { AuthorizationModel, GenericMessage } from './message-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

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