import type { EventEmitter } from 'events';
import type { EventHandler } from '../types/event-types.js';
import type { GenericMessage } from '../types/message-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { Filter, KeyValues } from '../types/query-types.js';

import { FilterUtility } from '../utils/filter.js';

export class SubscriptionBase {
  protected eventEmitter: EventEmitter;
  protected messageStore: MessageStore;
  protected filters: Filter[];
  protected tenant: string;
  protected message: GenericMessage;

  #unsubscribe: () => Promise<void>;
  #id: string;

  protected constructor(options: {
      tenant: string,
      message: GenericMessage,
      id: string,
      filters: Filter[],
      eventEmitter: EventEmitter,
      messageStore: MessageStore,
      unsubscribe: () => Promise<void>;
    }
  ) {
    const { tenant, id, filters, eventEmitter, message, messageStore, unsubscribe } = options;

    this.tenant = tenant;
    this.#id = id;
    this.filters = filters;
    this.eventEmitter = eventEmitter;
    this.message = message;
    this.messageStore = messageStore;
    this.#unsubscribe = unsubscribe;
  }

  get eventChannel(): string {
    return `${this.tenant}_${this.#id}`;
  }

  get id(): string {
    return this.#id;
  }

  protected matchFilter(tenant: string, ...indexes: KeyValues[]):boolean {
    return this.tenant === tenant &&
      indexes.find(index => FilterUtility.matchAnyFilter(index, this.filters)) !== undefined;
  }

  public listener = (tenant: string, message: GenericMessage, ...indexes: KeyValues[]):void => {
    if (this.matchFilter(tenant, ...indexes)) {
      this.eventEmitter.emit(this.eventChannel, message);
    }
  };

  on(handler: EventHandler): { off: () => void } {
    this.eventEmitter.on(this.eventChannel, handler);
    return {
      off: (): void => {
        this.eventEmitter.off(this.eventChannel, handler);
      }
    };
  }

  async close(): Promise<void> {
    this.eventEmitter.removeAllListeners(this.eventChannel);
    await this.#unsubscribe();
  }
}