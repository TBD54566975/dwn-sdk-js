import type { GenericMessageReply } from '../types/message-types.js';
import type { KeyValues } from './query-types.js';
import type { RecordsWriteMessage } from './records-types.js';
import type { GenericMessage, MessageSubscription } from './message-types.js';

export type EventListener = (tenant: string, event: EventMessage, indexes: KeyValues) => void;

/**
 * EventMessage contains the message being emitted and an optional initial write message.
 */
export type EventMessage = {
  message: GenericMessage;
  /** the initial write of the RecordsWrite or RecordsDelete message */
  initialWrite?: RecordsWriteMessage
};

/**
 * The EventStream interface implements a pub/sub system based on Message filters.
 */
export interface EventStream {
  subscribe(id: string, listener: EventListener): Promise<EventSubscription>;
  emit(tenant: string, event: EventMessage, indexes: KeyValues): void;
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
