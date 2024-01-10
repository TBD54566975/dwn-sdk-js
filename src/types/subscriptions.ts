import type { DwnError } from '../core/dwn-error.js';
import type { GenericMessageReply } from '../types/message-types.js';
import type { MessageStore } from './message-store.js';
import type { EventsSubscribeMessage, EventsSubscription } from './events-types.js';
import type { Filter, KeyValues } from './query-types.js';
import type { GenericMessage, GenericMessageHandler, GenericMessageSubscription } from './message-types.js';
import type { RecordsSubscribeMessage, RecordsSubscription } from './records-types.js';

export type EmitFunction = (tenant: string, message: GenericMessage, indexes: KeyValues) => void;

/**
 * The EventStream interface implements a pub/sub system based on Message filters.
 */
export interface EventStream {
  subscribe(tenant: string, message: EventsSubscribeMessage, filters: Filter[], messageStore: MessageStore): Promise<EventsSubscription>;
  subscribe(tenant: string, message: RecordsSubscribeMessage, filters: Filter[], messageStore: MessageStore): Promise<RecordsSubscription>;
  subscribe(tenant: string, message: GenericMessage, filters: Filter[], messageStore: MessageStore): Promise<GenericMessageSubscription>;
  emit(tenant: string, message: GenericMessage, indexes: KeyValues): void;
  open(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The SubscriptionHandler interface is implemented by specific types of Subscription Handlers.
 *
 * ie. `RecordsSubscriptionHandler` has behavior to re-authorize subscriptions.
 */
export interface SubscriptionHandler {
  id: string;
  listener: EmitFunction;
  on: (handler: GenericMessageHandler) => { off: () => void };
  onError: (handler: (error: DwnError) => void) => void;
  close: () => Promise<void>;
}

export type SubscriptionReply = GenericMessageReply & {
  subscription?: GenericMessageSubscription;
};