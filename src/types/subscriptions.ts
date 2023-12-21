import type { GenericMessageReply } from '../types/message-types.js';
import type { EventsSubscribeMessage, EventsSubscription } from './events-types.js';
import type { Filter, KeyValues } from './query-types.js';
import type { GenericMessage, GenericMessageHandler, GenericMessageSubscription } from './message-types.js';
import type { RecordsSubscribeMessage, RecordsSubscription } from './records-types.js';

export interface EventStream {
  subscribe(tenant: string, message: EventsSubscribeMessage, filters: Filter[]): Promise<EventsSubscription>;
  subscribe(tenant: string, message: RecordsSubscribeMessage, filters: Filter[]): Promise<RecordsSubscription>;
  subscribe(tenant: string, message: GenericMessage, filters: Filter[]): Promise<GenericMessageSubscription>;
  emit(tenant: string, message: GenericMessage, ...matchIndexes: KeyValues[]): void;
  open(): Promise<void>;
  close(): Promise<void>;
}

export interface Subscription {
  id: string;
  listener: (tenant: string, message: GenericMessage, ...indexes: KeyValues[]) => void;
  on: (handler: GenericMessageHandler) => { off: () => void };
  close: () => Promise<void>;
}

export type SubscriptionReply = GenericMessageReply & {
  subscription?: GenericMessageSubscription;
};