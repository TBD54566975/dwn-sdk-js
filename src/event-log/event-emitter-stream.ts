import type { KeyValues } from '../types/query-types.js';
import type { EventListener, EventStream, EventSubscription, MessageEvent } from '../types/subscriptions.js';

import { EventEmitter } from 'events';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

const EVENTS_LISTENER_CHANNEL = 'events';

export interface EventEmitterStreamConfig {
  /**
   * An optional error handler in order to be able to react to any errors or warnings triggers by `EventEmitter`.
   * By default we log errors with `console.error`.
   */
  errorHandler?: (error: any) => void;
};

export class EventEmitterStream implements EventStream {
  private eventEmitter: EventEmitter;
  private isOpen: boolean = false;

  constructor(config: EventEmitterStreamConfig = {}) {
    // we capture the rejections and currently just log the errors that are produced
    this.eventEmitter = new EventEmitter({ captureRejections: true });

    // number of listeners per particular eventName before a warning is emitted
    // we set to 0 which represents infinity.
    // https://nodejs.org/api/events.html#emittersetmaxlistenersn
    this.eventEmitter.setMaxListeners(0);

    if (config.errorHandler) {
      this.errorHandler = config.errorHandler;
    }

    this.eventEmitter.on('error', this.errorHandler);
  }

  /**
   * we subscribe to the `EventEmitter` error handler with a provided handler or set one which logs the errors.
   */
  private errorHandler: (error:any) => void = (error) => { console.error('event emitter error', error); };

  async subscribe(tenant: string, id: string, listener: EventListener): Promise<EventSubscription> {
    this.eventEmitter.on(`${tenant}_${EVENTS_LISTENER_CHANNEL}`, listener);
    return {
      id,
      close: async (): Promise<void> => { this.eventEmitter.off(`${tenant}_${EVENTS_LISTENER_CHANNEL}`, listener); }
    };
  }

  async open(): Promise<void> {
    this.isOpen = true;
  }

  async close(): Promise<void> {
    this.isOpen = false;
    this.eventEmitter.removeAllListeners();
  }

  emit(tenant: string, event: MessageEvent, indexes: KeyValues): void {
    if (!this.isOpen) {
      this.errorHandler(new DwnError(
        DwnErrorCode.EventEmitterStreamNotOpenError,
        'a message emitted when EventEmitterStream is closed'
      ));
      return;
    }
    this.eventEmitter.emit(`${tenant}_${EVENTS_LISTENER_CHANNEL}`, tenant, event, indexes);
  }
}