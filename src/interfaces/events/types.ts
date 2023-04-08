import type { BaseMessage } from '../../core/types.js';
import type { DwnInterfaceName, DwnMethodName } from '../../core/message.js';

export type EventsGetDescriptor = {
  interface : DwnInterfaceName.Events;
  method: DwnMethodName.Get;
  watermark?: string;
};

export type EventsGetMessage = BaseMessage & {
  descriptor: EventsGetDescriptor;
};