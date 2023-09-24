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

export type CallbackQueryRequest = RecordsFilter & {
  eventType?: EventType;
}

const eventChannel = "event";

// EventStream is a sinked stream for Events
export interface EventStreamI {
  add(e: EventMessageI<any>): Promise<void>

  on(eventType: EventType, f: (e: EventMessageI<any>) => void): EventEmitter
  open(): Promise<void>;
  close(): Promise<void>;
  clear(): Promise<void>;
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
  channelNames: {
    sync: string,
    operation: string,
    message: string,
    log: string;
  }
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
  private config: EventStreamConfig

  // TODO: Possibly add a buffered eventQueue for better handling. 
  // Event stream should pull off the queue. 
  constructor(config?: EventStreamConfig) {
    this.eventEmitter = new EventEmitter();
    this.config = { ...defaultConfig, ...config };
  }

  on(eventType: EventType, f: (e: EventMessageI<any>) => void): EventEmitter {
    let key: string
    switch (eventType) {
      case EventType.Log:
        key = this.config.channelNames.log;
        break;
      case EventType.Operation:
        key = this.config.channelNames.operation;
        break;
      case EventType.Sync:
        key = this.config.channelNames.sync;
        break;
      case EventType.Message:
        key = this.config.channelNames.message;
        break;
      default:
        throw new Error("unknown type. not sure what channel to listen to...")
        break;
    }
    return this.eventEmitter.on(key, f)
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

  private emitEvent(e: EventMessageI<any>): void {
    if (e.descriptor === undefined){
      throw new Error("descriptor not defined");
    }
    const descriptor = e.descriptor;
    switch (descriptor.type) {
      case EventType.Message:
        this.eventEmitter.emit(this.config.channelNames.message, e)
        break;
      case EventType.Sync:
        this.eventEmitter.emit(this.config.channelNames.sync, e)
        break;
      case EventType.Operation:
        this.eventEmitter.emit(this.config.channelNames.operation, e)
        break;
      case EventType.Log:
        this.eventEmitter.emit(this.config.channelNames.log, e)
        break;
      default:
        throw new Error("failed to emit event. unknown type")
        break;
    }
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