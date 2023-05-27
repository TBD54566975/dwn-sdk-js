import type { Readable } from 'readable-stream';
import type { DwnMessage, DwnMessageMap, DwnMessageReply } from './dwn-types.js';

/**
 * Interface that defines a message handler of a specific method.
 */
export interface MethodHandler<M extends keyof DwnMessageMap> {
  /**
   * Handles the given message and returns a `MessageReply` response.
   */
  handle(input: {
    tenant: string;
    message: DwnMessage<M>;
    dataStream?: Readable
  }): Promise<DwnMessageReply<M>>;
}