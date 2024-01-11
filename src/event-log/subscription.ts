import type { DwnError } from '../core/dwn-error.js';
import type { EventEmitter } from 'events';
import type { EventListener } from '../types/subscriptions.js';
import type { Filter, KeyValues } from '../types/query-types.js';
import type { GenericMessage, GenericMessageHandler } from '../types/message-types.js';

import { FilterUtility } from '../utils/filter.js';

/**
 * Base class to extend default subscription behavior.
 */
export class SubscriptionHandlerBase {
  protected eventEmitter: EventEmitter;
  protected filters: Filter[];
  protected tenant: string;
  protected message: GenericMessage;

  #id: string;

  protected constructor(options: {
      tenant: string,
      message: GenericMessage,
      id: string,
      filters: Filter[],
      eventEmitter: EventEmitter,
    }
  ) {
    const { tenant, id, filters, eventEmitter, message } = options;

    this.tenant = tenant;
    this.#id = id;
    this.filters = filters;
    this.eventEmitter = eventEmitter;
    this.message = message;
  }

  get eventChannel(): string {
    return `${this.tenant}_${this.#id}`;
  }

  get errorEventChannel(): string {
    return `${this.tenant}_${this.#id}_error`;
  }

  get id(): string {
    return this.#id;
  }

  protected matchFilters(tenant: string, indexes: KeyValues): boolean {
    return tenant === this.tenant && FilterUtility.matchAnyFilter(indexes, this.filters);
  }

  public listener: EventListener = (tenant, message, indexes):void => {
    if (this.matchFilters(tenant, indexes)) {
      this.eventEmitter.emit(this.eventChannel, message);
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

  onError(handler: (error: DwnError) => void): void {
    this.eventEmitter.on(this.errorEventChannel, handler);
  }

  async close(): Promise<void> {
    this.eventEmitter.removeAllListeners(this.eventChannel);
    this.eventEmitter.removeAllListeners(this.errorEventChannel);
    // await this.#unsubscribe();
  }
}