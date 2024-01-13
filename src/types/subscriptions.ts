import type { GenericMessage } from './message-types.js';
import type { KeyValues } from './query-types.js';

export type EventListener = (tenant: string, message: GenericMessage, indexes: KeyValues) => void;

/**
 * The EventStream interface implements a pub/sub system based on Message filters.
 */
export interface EventStream {
  subscribe(id: string, listener: EventListener): Promise<EventSubscription>;
  emit(tenant: string, message: GenericMessage, indexes: KeyValues): void;
  open(): Promise<void>;
  close(): Promise<void>;
}

export interface EventSubscription {
  id: string;
  close: () => Promise<void>;
}