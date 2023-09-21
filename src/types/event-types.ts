import type { Event } from './event-log.js';
import type { GenericMessage } from './message-types.js';
import type { GenericMessageReply } from '../core/message-reply.js';
import { DwnInterfaceName, DwnMethodName } from '../core/message.js';
import { RecordsFilter, RecordsWriteDescriptor } from './records-types.js';

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

/*
*  v2 of event implementation. 
*/ 

/**
 * Enum defining generic event types.
 */
export enum EventType {
  Message = 'Message',    // Represents a message event.
  Sync = 'Sync',          // Represents a synchronization event.
  Operation = 'Operation' // Represents an operation event.
}

/*
* Events are generic
*/
export type EventDescriptor = {
  // The timestamp of the event.
  eventTimestamp?: string;
  // The duration of the event.
  eventDuration?: string; 
  //A description of the event.
  description?: string;
  // The type of the event.
  type?: EventType;
  // The unique identifier of the event.
  eventId?: string;
};

export interface OperationEventDescriptor extends EventDescriptor {
  // The interface associated with the event.
  interface? : DwnInterfaceName;
  // The method associated with the event.
  method?: DwnMethodName;
  // event type
  type: EventType.Operation;
}

export type OperationEventMessage = GenericMessage & {
  descriptor: OperationEventDescriptor;
};

// Event message
export type EventMessage = GenericMessage & {
  descriptor: EventDescriptor;
};

export type MessageEventDescriptor = EventDescriptor & RecordsWriteDescriptor & {
  type: EventType.Message;
  // The context ID associated with the event.
  contextId?: string;
  // The message CID associated with the event.
  messageCid?: string;
  // The tenant associated with the event.
  tenant?: string;
}

export type MessageEventMessage = GenericMessage & {
  descriptor: MessageEventDescriptor;
};

export type SyncEventSubscriptor =  EventDescriptor & {
  interface : DwnInterfaceName.Events;
  eventType: EventType.Sync;
  method: DwnMethodName.Get;
  watermark?: string;
  messageTimestamp: string;
};

export type EventFilter = RecordsFilter & {
  // filter by event type
  eventType?: EventType;
  // filter by interface
  interface? : DwnInterfaceName;
  // filter by method
  method?: DwnMethodName;
};
