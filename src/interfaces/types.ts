import type { BaseMessage } from '../core/types.js';
import type { MessageReply } from '../core/message-reply.js';
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
    message: BaseMessage;
    dataStream?: Readable
  }): Promise<MessageReply>;
}