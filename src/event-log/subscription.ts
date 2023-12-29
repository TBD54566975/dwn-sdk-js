import type { EventEmitter } from 'events';
import type { Filter } from '../types/query-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { EmitFunction, EventMessageData, Subscription } from '../types/subscriptions.js';
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

  protected matchMessages(tenant: string, current: EventMessageData, mostRecent?: EventMessageData): GenericMessage[] {
    const emitArgs:GenericMessage[] = [];
    if (tenant === this.tenant) {
      if (FilterUtility.matchAnyFilter(current.indexes, this.filters)) {
        emitArgs.push(current.message);
      } else if (mostRecent !== undefined && FilterUtility.matchAnyFilter(mostRecent.indexes, this.filters)) {
        emitArgs.push(current.message, mostRecent.message);;
      }
    }
    return emitArgs;
  }

  public listener: EmitFunction = (tenant, current, mostRecent):void => {
    const emitArgs = this.matchMessages(tenant, current, mostRecent);
    if (emitArgs.length > 0) {
      this.eventEmitter.emit(this.eventChannel, ...emitArgs);
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