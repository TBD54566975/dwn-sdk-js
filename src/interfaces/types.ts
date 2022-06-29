import type { Context } from '../types';
import type { MessageSchema } from '../core/types';
import type { MessageStore } from '../store/message-store';
import type { MessageReply } from '../core/message-reply';

import { DIDResolver } from '../did/did-resolver';

export type MethodHandler = (
  ctx: Context,
  message: MessageSchema,
  messageStore: MessageStore,
  didResolver: DIDResolver) => Promise<MessageReply>;

export interface Interface {
  methodHandlers: MethodHandler[];
  schemas: { [key:string]: object };
}