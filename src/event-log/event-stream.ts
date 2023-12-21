import type { DidResolver } from '../did/did-resolver.js';
import type { MessageStore } from '../types/message-store.js';
import type { EventsSubscribeMessage, EventsSubscription } from '../types/events-types.js';
import type { EventStream, Subscription } from '../types/subscriptions.js';
import type { Filter, KeyValues } from '../types/query-types.js';
import type { GenericMessage, GenericMessageSubscription } from '../types/message-types.js';
import type { RecordsSubscribeMessage, RecordsSubscription } from '../types/records-types.js';

import { EventEmitter } from 'events';
import { EventsSubscribe } from '../interfaces/events-subscribe.js';
import { EventsSubscriptionHandler } from '../handlers/events-subscribe.js';
import { Message } from '../core/message.js';
import { RecordsSubscribe } from '../interfaces/records-subscribe.js';
import { RecordsSubscriptionHandler } from '../handlers/records-subscribe.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

const eventChannel = 'events';

type EventStreamConfig = {
  emitter?: EventEmitter;
  messageStore: MessageStore;
  didResolver: DidResolver;
  reauthorizationTTL?: number;
};

export class EventStreamEmitter implements EventStream {
  private eventEmitter: EventEmitter;
  private didResolver: DidResolver;
  private messageStore: MessageStore;
  private reauthorizationTTL: number;

  private isOpen: boolean = false;
  private subscriptions: Map<string, Subscription> = new Map();

  constructor(config: EventStreamConfig) {
    this.didResolver = config.didResolver;
    this.messageStore = config.messageStore;
    this.reauthorizationTTL = config.reauthorizationTTL ?? 0; // if set to zero it does not reauthorize

    // we capture the rejections and currently just log the errors that are produced
    this.eventEmitter = config.emitter || new EventEmitter({ captureRejections: true });
  }

  private get eventChannel(): string {
    return `${eventChannel}_bus`;
  }

  private eventError = (error: any): void => {
    console.error('event emitter error', error);
  };

  async subscribe(tenant: string, message: EventsSubscribeMessage, filters: Filter[]): Promise<EventsSubscription>;
  async subscribe(tenant: string, message: RecordsSubscribeMessage, filters: Filter[]): Promise<RecordsSubscription>;
  async subscribe(tenant: string, message: GenericMessage, filters: Filter[]): Promise<GenericMessageSubscription> {
    const messageCid = await Message.getCid(message);
    let subscription = this.subscriptions.get(messageCid);
    if (subscription !== undefined) {
      return subscription;
    }

    const unsubscribe = async ():Promise<void> => { await this.unsubscribe(messageCid); };

    if (RecordsSubscribe.isRecordsSubscribeMessage(message)) {
      subscription = await RecordsSubscriptionHandler.create({
        tenant,
        message,
        filters,
        unsubscribe,
        eventEmitter       : this.eventEmitter,
        messageStore       : this.messageStore,
        reauthorizationTTL : this.reauthorizationTTL,
      });
    } else if (EventsSubscribe.isEventsSubscribeMessage(message)) {
      subscription = await EventsSubscriptionHandler.create(tenant, message, filters, this.eventEmitter, this.messageStore, unsubscribe);
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

  emit(tenant: string, message: GenericMessage, ...matchIndexes: KeyValues[]): void {
    if (!this.isOpen) {
      //todo: dwn error
      throw new Error('Event stream is not open. Cannot add to the stream.');
    }
    try {
      this.eventEmitter.emit(this.eventChannel, tenant, message, ...matchIndexes);
    } catch (error) {
      //todo: dwn catch error;
      throw error; // You can choose to handle or propagate the error as needed.
    }
  }
}