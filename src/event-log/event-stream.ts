import type { MessageStore } from '../types/message-store.js';
import type { EventsSubscribeMessage, EventsSubscription } from '../types/events-types.js';
import type { EventStream, SubscriptionHandler } from '../types/subscriptions.js';
import type { Filter, KeyValues } from '../types/query-types.js';
import type { GenericMessage, GenericMessageSubscription } from '../types/message-types.js';

import { EventEmitter } from 'events';
import { EventsSubscribe } from '../interfaces/events-subscribe.js';
import { EventsSubscriptionHandler } from '../handlers/events-subscribe.js';
import { Message } from '../core/message.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

const eventChannel = 'events';

type EventStreamConfig = {
  emitter?: EventEmitter;
  reauthorizationTTL?: number;
};

export class EventStreamEmitter implements EventStream {
  private eventEmitter: EventEmitter;
  private reauthorizationTTL: number;

  private isOpen: boolean = false;
  private subscriptions: Map<string, SubscriptionHandler> = new Map();

  constructor(config?: EventStreamConfig) {
    this.reauthorizationTTL = config?.reauthorizationTTL || 0; // if set to zero it does not reauthorize

    // we capture the rejections and currently just log the errors that are produced
    this.eventEmitter = config?.emitter || new EventEmitter({ captureRejections: true });
  }

  private get eventChannel(): string {
    return `${eventChannel}_bus`;
  }

  // we subscribe to the general `EventEmitter` error events with this handler.
  // this handler is also called when there is a caught error upon emitting an event from a handler.
  private eventError = (error: any): void => {
    console.error('event emitter error', error);
  };

  async subscribe(tenant: string, message: EventsSubscribeMessage, filters: Filter[], messageStore: MessageStore): Promise<EventsSubscription>;
  async subscribe(tenant: string, message: GenericMessage, filters: Filter[], messageStore: MessageStore): Promise<GenericMessageSubscription> {
    const messageCid = await Message.getCid(message);
    let subscription = this.subscriptions.get(messageCid);
    if (subscription !== undefined) {
      return subscription;
    }

    if (EventsSubscribe.isEventsSubscribeMessage(message)) {
      subscription = await EventsSubscriptionHandler.create({
        tenant,
        message,
        filters,
        messageStore,
        unsubscribe  : () => this.unsubscribe(messageCid),
        eventEmitter : this.eventEmitter,
      });
    } else {
      throw new DwnError(DwnErrorCode.EventStreamSubscriptionNotSupported, 'not a supported subscription message');
    }

    this.subscriptions.set(messageCid, subscription);
    this.eventEmitter.addListener(this.eventChannel, subscription.listener);

    return subscription;
  }

  private async unsubscribe(id:string): Promise<void> {
    const subscription = this.subscriptions.get(id);
    if (subscription !== undefined) {
      this.subscriptions.delete(id);
      this.eventEmitter.removeListener(this.eventChannel, subscription.listener);
    }
  }

  async open(): Promise<void> {
    this.eventEmitter.on('error', this.eventError);
    this.isOpen = true;
  }

  async close(): Promise<void> {
    this.isOpen = false;
    this.eventEmitter.removeAllListeners();
  }

  emit(tenant: string, message: GenericMessage, indexes: KeyValues): void {
    if (!this.isOpen) {
      // silently ignore.
      return;
    }
    try {
      this.eventEmitter.emit(this.eventChannel, tenant, message, indexes);
    } catch (error) {
      this.eventError(error);
    }
  }
}