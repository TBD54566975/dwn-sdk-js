import type { Readable } from 'readable-stream';
import type { GenericMessage, GenericMessageReply, MessageSubscriptionHandler } from './message-types.js';

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
    subscriptionHandler?: MessageSubscriptionHandler;
  }): Promise<GenericMessageReply>;
}