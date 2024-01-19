import type { GenericMessage } from '../types/message-types.js';
import type { KeyValues } from '../types/query-types.js';
import type { EventListener, EventStream, EventSubscription } from '../types/subscriptions.js';

import { EventEmitter } from 'events';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

const EVENTS_LISTENER_CHANNEL = 'events';

export interface EventEmitterStreamConfig {
  /**
   * The maximum number of listeners per eventName before a warning is emitted.
   * 0 would represent infinity, which is the default if no value is set.
   *
   * this is not a hard limit, only a limit for warnings to be emitted so that a memory leak could be found.
   * it will output a trace warning to stderr indicating that a "possible EventEmitter memory leak"
   * https://nodejs.org/api/events.html#emittersetmaxlistenersn
   * */
  maxListeners?: number;

  /**
   * An optional error handler in order to be able to react to any errors or warnings triggers by `EventEmitter`.
   * By default we log errors with `console.error`.
   */
  errorHandler?: (error: any) => void;
};

export class EventEmitterStream implements EventStream {
  private eventEmitter: EventEmitter;
  private isOpen: boolean = false;

  constructor(config?: EventEmitterStreamConfig) {
    // we capture the rejections and currently just log the errors that are produced
    this.eventEmitter = new EventEmitter({ captureRejections: true });

    // set number of listeners per particular eventName before a warning is emitted, the default is 10, 0 is infinity.
    // this is not a hard limit, only a limit for warnings to be emitted so that a memory leak could be found.
    // it will output a trace warning to stderr indicating that a "possible EventEmitter memory leak"
    // https://nodejs.org/api/events.html#emittersetmaxlistenersn
    const maxListeners = config?.maxListeners ?? 0;
    this.eventEmitter.setMaxListeners(maxListeners);

    if (config?.errorHandler) {
      this.errorHandler = config.errorHandler;
    }

    this.eventEmitter.on('error', this.errorHandler);
  }

  /**
   * we subscribe to the `EventEmitter` error handler with a provided handler or set one which logs the errors.
   */
  private errorHandler: (error:any) => void = (error) => { console.error('event emitter error', error); };

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
      this.errorHandler(new DwnError(
        DwnErrorCode.EventEmitterStreamNotOpenError,
        'a message emitted when EventEmitterStream is closed'
      ));
      return;
    }
    this.eventEmitter.emit(EVENTS_LISTENER_CHANNEL, tenant, message, indexes);
  }
}