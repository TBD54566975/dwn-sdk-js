import type { BaseMessage } from '../core/types.js';
import type { MessageReply } from '../core/message-reply.js';
import type { MessageStore } from '../store/message-store.js';

import { DidResolver } from '../did/did-resolver.js';

export type MethodHandler = (
  message: BaseMessage,
  messageStore: MessageStore,
  didResolver: DidResolver) => Promise<MessageReply>;

export interface Interface {
  methodHandlers: MethodHandler[];
  schemas: { [key:string]: object };
}