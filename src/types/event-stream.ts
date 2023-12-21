import type { GenericMessage } from './message-types.js';
import type { EventHandler, EventsSubscribeMessage, EventSubscription } from './event-types.js';
import type { Filter, KeyValues } from './query-types.js';
import type { RecordsSubscribeMessage, RecordsSubscription } from './records-types.js';


export interface EventStream {
  subscribe(tenant: string, message: EventsSubscribeMessage, filters: Filter[]): Promise<EventSubscription>;
  subscribe(tenant: string, message: RecordsSubscribeMessage, filters: Filter[]): Promise<RecordsSubscription>;
  subscribe(tenant: string, message: GenericMessage, filters: Filter[]): Promise<EventSubscription>;
  emit(tenant: string, message: GenericMessage, ...matchIndexes: KeyValues[]): void;
  open(): Promise<void>;
  close(): Promise<void>;
}

export interface EventStreamSubscription {
  id: string;
  listener: (tenant: string, message: GenericMessage, ...indexes: KeyValues[]) => void;
  on: (handler: EventHandler) => { off: () => void };
  close: () => Promise<void>;
}