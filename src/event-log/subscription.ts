import type { EventEmitter } from 'events';
import type { MessageStore } from '../types/message-store.js';
import type { EmitFunction, Subscription } from '../types/subscriptions.js';
import type { Filter, KeyValues } from '../types/query-types.js';
import type { GenericMessage, GenericMessageHandler } from '../types/message-types.js';

import { FilterUtility } from '../utils/filter.js';

export class SubscriptionBase implements Subscription {
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

  protected matchFilter(tenant: string, indexes: KeyValues, ...additionalIndexes: KeyValues[]): { match: boolean, updated?: boolean } {
    const initialMatch = FilterUtility.matchAnyFilter(indexes, this.filters);
    const additionalMatch =
      additionalIndexes.length > 0 ? additionalIndexes.find(index => FilterUtility.matchAnyFilter(index, this.filters)) !== undefined : undefined;
    const match = this.tenant === tenant && (initialMatch === true || additionalMatch === true);
    const updated = additionalMatch ? additionalMatch === true && !initialMatch : undefined;
    return { match, updated };
  }

  public listener: EmitFunction = (tenant, message, indexes, ...additionalIndexes):void => {
    const { match, updated } = this.matchFilter(tenant, indexes, ...additionalIndexes);
    if (match === true) {
      this.eventEmitter.emit(this.eventChannel, message, updated);
    }
  };

  on(handler: GenericMessageHandler): { off: () => void } {
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