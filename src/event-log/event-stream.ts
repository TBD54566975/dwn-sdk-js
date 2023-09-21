import { RecordsFilter } from '../types/records-types.js';
import type { EventType, EventMessage, EventFilter, MessageEventMessage } from '../types/event-types.js';

export type CallbackQueryRequest = RecordsFilter & { 
  eventType?: EventType;
}

// EventStream is a sinked stream for Events
// TODO: change RecordEventMessage to generic message.
export interface EventStreamI {
  installCallback(filters: EventFilter, callback: (e: MessageEventMessage) => Promise<void>): Promise<void>;
  removeCallback(callbackId: string): Promise<void>; // callback id;
  queryCallbacks(query: CallbackQueryRequest): Promise<EventStreamCallbackFunction[]>;

  add(e: EventMessage) : Promise<void>
}

/*
* Event callback wraps a callback function which
* will be applied to a set scoped set of events
* that hit the stream.
*/
type EventStreamCallbackFunction = {
  id: string;
  desctription?: string; // callback description;
  callback: (e: MessageEventMessage) => Promise<void>;
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

    private callbacks: Map<string, EventStreamCallbackFunction>
    isOpen: boolean = false;

    // TODO: Possibly add a buffered eventQueue for better handling. 
    // Event stream should pull off the queue. 
    constructor(){
        this.callbacks = new Map<string, EventStreamCallbackFunction>();
    }

    async installCallback(filter: EventFilter, callback: (e: MessageEventMessage) => Promise<void>): Promise<void> {
      // TODO create callback id
      const id = "FIXME"
      this.callbacks.set(id, {
        id: id,
        filter: filter,
        callback: callback,
      } )
    }
  
    async removeCallback(callbackId: string): Promise<void> {
      this.callbacks.delete(callbackId);
    }
  
    // TODO: Better logic here.
    // Check what's the right way to map paths out.
    // Given a filter and a callback function, determines if it's scoped to be applied.
    callbackInScope(req: CallbackQueryRequest, f: EventStreamCallbackFunction): boolean {
      if (f.filter.contextId === req.contextId){
        return true
      }
      return false;
    }

    // Get all the callback ids;
    getCallbackIds() : string[] {
      return Array.from(this.callbacks.keys());
    }

    /*
    * TODO: optimize. this.
    * returns a subset of callbacks that are
    * in scope for a particular filter.
    */
    async queryCallbacks(query: CallbackQueryRequest): Promise<EventStreamCallbackFunction[]> {
      const filteredCallbacks: EventStreamCallbackFunction[] = [];
      for (const [key, callback] of this.callbacks) {
        if (this.callbackInScope(query, callback)) {
          filteredCallbacks.push(callback);
        }
      }
      return Promise.all(filteredCallbacks);
    }
  
    async clear(): Promise<void> {
      this.callbacks.clear();
    }

    async close(): Promise<void> {
        this.isOpen = false;
    }
  
    async open(): Promise<void> {
        this.isOpen = true;
    }
  
    // adds to the event stream.
    // right now, we are doing some very basic callback handling. 
    // but in cases of high performance, 
    // an internal queue state can be maintained. 
    // which can be used to improve resiliance
    // for event processing. 
    async add(e: MessageEventMessage): Promise<void> {
      if (!this.isOpen) {
        throw new Error("Event stream is not open. Cannot add to the stream.");
      }
      try {
        // find installed callbacks that are part of this scope
        const callbacks = await this.queryCallbacks({ contextId: e.descriptor.contextId});
        for (const callback of callbacks) {
          await callback.callback(e);
        }
      } catch (error) {
        // Handle any errors that occur during the process.
        console.error("Error while adding to the event stream:", error);
        throw error; // You can choose to handle or propagate the error as needed.
      }
    }
  }