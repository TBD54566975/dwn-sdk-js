import type { EventsHandler } from './events-types.js';
import type { Readable } from 'readable-stream';
import type { RecordsHandler } from './records-types.js';

/**
 *  MessageOptions that are used when processing a message.
 */
export type MessageOptions = {
  dataStream?: Readable;
  handler?: GenericMessageHandler;
};

export type GenericMessageHandler = EventsHandler | RecordsHandler;
