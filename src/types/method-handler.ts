import type { BaseMessage } from './message-types.js';
import type { BaseMessageReply } from '../core/message-reply.js';
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
  }): Promise<BaseMessageReply>;
}