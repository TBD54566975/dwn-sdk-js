import type { BaseMessage } from '../core/types';
import type { MessageReply } from '../core/message-reply';
import type { MessageStore } from '../store/message-store';

import { DidResolver } from '../did/did-resolver';

export type MethodHandler = (
  message: BaseMessage,
  messageStore: MessageStore,
  didResolver: DidResolver) => Promise<MessageReply>;

export interface Interface {
  methodHandlers: MethodHandler[];
  schemas: { [key:string]: object };
}