import type { BaseMessage } from '../core/types.js';
import type { MessageReply } from '../core/message-reply.js';
import type { MessageStore } from '../store/message-store.js';

import { DidResolver } from '../did/did-resolver.js';
import { Readable } from 'readable-stream';

export type MethodHandler = (input: {
  tenant: string;
  message: BaseMessage;
  dataStream?: Readable
  messageStore: MessageStore;
  didResolver: DidResolver
}) => Promise<MessageReply>;

export interface Interface {
  methodHandlers: MethodHandler[];
  schemas: { [key:string]: object };
}