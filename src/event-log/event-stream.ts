import { RecordsFilter } from '../types/records-types.js';
import {
  EventType,
  EventMessageI,
  EventDescriptor,
  AllEventMessageTypes,
  EventFilter,
  InterfaceEventDescriptor,
  RecordEventDescriptor,
  SyncEventDescriptor,
} from '../types/event-types.js';
import { EventEmitter } from 'events';
import { SubscriptionFilter } from '../types/subscriptions-request.js';

export type CallbackQueryRequest = RecordsFilter & {
  eventType?: EventType;
}

const eventChannel = "event";

// EventStream is a sinked stream for Events
export interface EventStreamI {
  add(e: EventMessageI<any>): Promise<void>

  on(f: (e: EventMessageI<any>) => void): EventEmitter
  open(): Promise<void>;
  close(): Promise<void>;
  clear(): Promise<void>;
  id(): string; // returns the id
}

export const defaultConfig = {
  channelNames: {
    event: "event",
    sync: "sync",
    operation: "operation",
    log: "log",
    message: "message",
  }
}

type EventStreamConfig = {
  channelNames?: {
    sync: string,
    operation: string,
    message: string,
    log: string;
  },
  emitter?: EventEmitter,
}

/*
* Event stream provides a single pipeline for 
* Event data to pass through. 
* It allows for developers to attach multiple callback functions
* To an event stream, and also allows event buffering 
* if needed. 
* 
* A few known use cases:
*  - attaching a logger to the end of a event stream
*  - attaching telemetry to the event stream.
*  - attaching callback functions for subscription use case.
*
* Note: We are purposely not queueing jobs in right now, so 
* there is no internal state handling, but you could make an event 
* stream some kafka like streamer if you wanted.
*/
export class EventStream implements EventStreamI {

  private isOpen: boolean = false;
  private eventEmitter: EventEmitter;
  private config: EventStreamConfig;
  #id: string;
  #parentId: string = "";

  constructor(config?: EventStreamConfig) {
    let emitter: EventEmitter
    if (config?.emitter === undefined) {
      emitter = new EventEmitter();
    } else {
      emitter = config.emitter;
    }
    this.#id = this.genUniqueId();

    const channelConfig = {
      ...(defaultConfig.channelNames || {}),
      ...(config?.channelNames || {}),
    };

    this.config = {
      channelNames: channelConfig,
      emitter: emitter,
    };

    this.eventEmitter = emitter;
  }

  id(): string {
    return this.#id;
  }

  // improve. temporary. just for now....
  genUniqueId(): string {
    const dateStr = Date
      .now()
      .toString(36); // convert num to base 36 and stringify
    const randomStr = Math
      .random()
      .toString(36)
      .substring(2, 8); // start at index 2 to skip decimal point

    return `${dateStr}-${randomStr}`;
  }

  on(f: (e: EventMessageI<any>) => void, filter?: (e: EventMessageI<any>) => boolean): EventEmitter {
    return this.eventEmitter.on(eventChannel, (event) => {f(event)});
  }
  
  createChild(filter?: (e: EventMessageI<any>) => boolean, transform?: (e: EventMessageI<any>) => EventMessageI<any>): EventStream {
    const childConfig: EventStreamConfig = {
      emitter: new EventEmitter(),
    };
    const childStream = new EventStream(childConfig);
    childStream.#parentId = this.#id;
    // Attach event handler to the parent stream
    this.eventEmitter.on(eventChannel, (event) => {
      if (!filter || filter(event)) {
        // If a filter is provided and it passes, emit the event in the child stream
        if (transform) {
          // If a transform function is provided, apply it to the event
          const transformedEvent = transform(event);
          childStream.add(transformedEvent);
        } else {
          childStream.add(event);
        }
      }
    });
    return childStream;
  }

  async close(): Promise<void> {
    this.isOpen = false;
  }

  async clear(): Promise<void> {
    throw new Error("clear not available in event emitter...")
  }

  async open(): Promise<void> {
    this.isOpen = true;
  }

  private async emitEvent(e: EventMessageI<any>): Promise<void> {
    if (e.descriptor === undefined) {
      throw new Error("descriptor not defined");
    }
    if (e.descriptor.type == undefined ) {
      throw new Error("descriptor type not defined");
    }
    this.eventEmitter.emit(eventChannel, e);
  }

  // adds to the event stream.
  // right now, we are doing some very basic callback handling. 
  // but in cases of high performance, 
  // an internal queue state can be maintained. 
  // which can be used to improve resiliance
  // for event processing. 
  async add(e: EventMessageI<any>): Promise<void> {
    if (!this.isOpen) {
      throw new Error("Event stream is not open. Cannot add to the stream.");
    }
    try {
      this.emitEvent(e)
    } catch (error) {
      throw error; // You can choose to handle or propagate the error as needed.
    }
  }
}
