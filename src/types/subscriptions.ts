import type { GenericMessageReply } from '../types/message-types.js';
import type { KeyValues } from './query-types.js';
import type { RecordsWriteMessage } from './records-types.js';
import type { GenericMessage, MessageSubscription } from './message-types.js';

export type EventListener = (tenant: string, message: GenericMessage, indexes: KeyValues) => void;

/**
 * The EventMessage type is a generic message with an optional initialWrite property.
 */
export type EventMessage = GenericMessage & {
  /** the initial write of the RecordsWrite or RecordsDelete message */
  initialWrite?: RecordsWriteMessage
};

/**
 * The EventStream interface implements a pub/sub system based on Message filters.
 */
export interface EventStream {
  subscribe(id: string, listener: EventListener): Promise<EventSubscription>;
  emit(tenant: string, message: EventMessage, indexes: KeyValues): void;
  open(): Promise<void>;
  close(): Promise<void>;
}

export interface EventSubscription {
  id: string;
  close: () => Promise<void>;
}

export type SubscriptionReply = GenericMessageReply & {
  subscription?: MessageSubscription;
};
