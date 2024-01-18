import type { GenericMessage } from '../types/message-types.js';
import type { KeyValues } from '../types/query-types.js';
import type { EventListener, EventStream, EventSubscription } from '../types/subscriptions.js';

import { EventEmitter } from 'events';

const EVENTS_LISTENER_CHANNEL = 'events';

export class EventEmitterStream implements EventStream {
  private eventEmitter: EventEmitter;
  private isOpen: boolean = false;

  constructor() {
    // we capture the rejections and currently just log the errors that are produced
    this.eventEmitter = new EventEmitter({ captureRejections: true });
    this.eventEmitter.on('error', this.eventError);
  }

  // we subscribe to the general `EventEmitter` error events with this handler.
  // this handler is also called when there is a caught error upon emitting an event from a handler.
  private eventError(error: any): void {
    console.error('event emitter error', error);
  };

  async subscribe(id: string, listener: EventListener): Promise<EventSubscription> {
    this.eventEmitter.on(EVENTS_LISTENER_CHANNEL, listener);
    return {
      id,
      close: async (): Promise<void> => { this.eventEmitter.off(EVENTS_LISTENER_CHANNEL, listener); }
    };
  }

  async open(): Promise<void> {
    this.isOpen = true;
  }

  async close(): Promise<void> {
    this.isOpen = false;
    this.eventEmitter.removeAllListeners();
  }

  emit(tenant: string, message: GenericMessage, indexes: KeyValues): void {
    if (!this.isOpen) {
      // silently ignore
      return;
    }
    this.eventEmitter.emit(EVENTS_LISTENER_CHANNEL, tenant, message, indexes);
  }
}