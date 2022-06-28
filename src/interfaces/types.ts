import type { Context } from '../types';
import type { JsonMessage } from '../messages/types';
import type { MessageStore } from '../store/message-store';
import type { MessageReply } from '../response/message-reply';

import { DIDResolver } from '../did/did-resolver';

export type MethodHandler = (
  ctx: Context,
  message: JsonMessage,
  messageStore: MessageStore,
  didResolver: DIDResolver) => Promise<MessageReply>;

export interface Interface {
  methodHandlers: MethodHandler[];
  schemas: { [key:string]: object };
}