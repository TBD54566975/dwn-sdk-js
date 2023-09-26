import type { Event } from './event-log.js';
import type { GeneralJws } from './jws-types.js';
import type { GenericMessage } from './message-types.js';
import type { GenericMessageReply } from '../core/message-reply.js';
import type { RecordsFilter } from './records-types.js';

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

/*
*  ----------------------------------------------------------
*  Event Stream Updates Below
*  ----------------------------------------------------------
*/

/**
 * Enum defining generic event types.
 */
export enum EventType {
  Message = 'Message', // Represents a message event.
  Sync = 'Sync', // Represents a synchronization event.
  Operation = 'Operation', // Represents an operation event.
  Log = 'Log' // represents a log event.
}


export type EventsCreateDescriptor = {
  interface : DwnInterfaceName.Subscriptions;
  method: DwnMethodName.Request;
  messageTimestamp: string;
  messageId?: string; // attached message
  eventDescriptor?: EventDescriptor
};

export type EventDescriptor = {
  interface?: DwnInterfaceName;
  // interface
  method?: DwnMethodName;
  // method
  messageTimestamp: string;
  // The timestamp of the event.
  eventTimestamp?: string;
  // The duration of the event.
  eventDuration?: string;
  //A description of the event.
  description?: string;
  // The type of the event.
  type: EventType;
  // tags help search events.
  tags?: Map<string, any>
  // The unique identifier of the event.
  eventId?: string;
};

export type BaseEventMessage = GenericMessage & {
  descriptor: EventDescriptor;
};

export type InterfaceEventDescriptor = EventDescriptor & {
  // The interface associated with the event.
  interface? : DwnInterfaceName;
  // The method associated with the event.
  method?: DwnMethodName;
  // event type
  type: EventType.Operation;
};

export type InterfaceEventMessage = BaseEventMessage & {
  descriptor: InterfaceEventDescriptor;
};

export type RecordEventDescriptor = InterfaceEventDescriptor & {
  protocolPath?: string;
  recipient?: string;
  schema?: string;
  parentId?: string;
  dataCid: string;
  dataSize: number;
  dateCreated: string;
  messageTimestamp: string;
  published?: boolean;
  datePublished?: string;
  dataFormat: string;

  type: EventType.Message;
  // The context ID associated with the event.
  contextId?: string;
  // The message CID associated with the event.
  messageCid?: string;
  // The tenant associated with the event.
  tenant?: string;
};

export type RecordEventMessage = BaseEventMessage & {
  descriptor: RecordEventDescriptor;
};

export type SyncEventDescriptor = EventDescriptor & {
  type: EventType.Sync;
  interface?: DwnInterfaceName.Events;
  method?: DwnMethodName.Get;
  watermark?: string;
  messageTimestamp?: string;
};

export type SyncEventMessage = BaseEventMessage & {
  descriptor: SyncEventDescriptor;
};

export type EventFilter = RecordsFilter & {
  // filter by event type
  eventType?: EventType;
  // filter by interface
  interface? : DwnInterfaceName;
  // filter by method
  method?: DwnMethodName;
};


export type EventMessageI<T extends EventDescriptor> = GenericMessage & {
  descriptor: T;
  authorization?: GeneralJws;
};
