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

  on(f: Function): EventEmitter;
  open(): Promise<void>;
  close(): Promise<void>;
  clear(): Promise<void>;
}

/*
* Event callback wraps a callback function which
* will be applied to a set scoped set of events
* that hit the stream.
*/
type EventStreamCallbackFunction = {
  id: string;
  desctription?: string; // callback description;
  callback: (e: AllEventMessageTypes) => Promise<void>;
  filter: EventFilter;
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
  private _eventChannel: string;

  // TODO: Possibly add a buffered eventQueue for better handling. 
  // Event stream should pull off the queue. 
  constructor(eventChannel: string = "event") {
    this.eventEmitter = new EventEmitter();
    this._eventChannel = eventChannel;
  }

  on(f: (e: EventMessageI<any>) => void): EventEmitter {
    return this.eventEmitter.on(this._eventChannel, f)
  }

  get channel(): string {
    return this.channel;
  }

  set channel(c: string) {
    this._eventChannel = this.channel
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
    this.eventEmitter.emit(this._eventChannel, e);
  }

  /*
  * override emitter. cannot override event topic.
  */
  async addCustomObject(topic: string, o: any): Promise<void> {
    if (topic === this._eventChannel) {
      throw new Error("can't add any object tppic over event channel. use addEvent instead...")
    }
    this.eventEmitter.emit(topic, o)
  }

  handleEventMessage(e: EventMessageI<any>){
      // TODO: Different handlers for different types.
      const descriptor = e.descriptor;
      switch (descriptor.type) {
        case EventType.Message:
          const messageEventDescriptor = descriptor as RecordEventDescriptor;
          console.log(messageEventDescriptor);
          break;
        case EventType.Sync:
          const syncEventDescriptor = descriptor as SyncEventDescriptor;
          console.log(syncEventDescriptor);
          break;
        case EventType.Operation:
          const operationEventDescriptor = descriptor as InterfaceEventDescriptor;
          console.log(operationEventDescriptor);
          break;
        default:
          console.error('Unknown Event Type:', descriptor);
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