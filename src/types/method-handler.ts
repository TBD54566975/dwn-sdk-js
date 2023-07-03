import type { GenericMessage } from './message-types.js';
import type { GenericMessageReply } from '../core/message-reply.js';
import type { Readable } from 'readable-stream';

/**
 * Interface that defines a message handler of a specific method.
 */
export interface MethodHandler {
  /**
   * Handles the given message and returns a `MessageReply` response.
   */
  handle(input: {
    tenant: string;
    message: GenericMessage;
    dataStream?: Readable
  }): Promise<GenericMessageReply>;
}