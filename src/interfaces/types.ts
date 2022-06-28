import type { Context } from '../types';
import type { MessageJson } from '../messages/types';
import type { MessageStore } from '../store/message-store';
import type { MessageReply } from '../response/message-reply';

import { DIDResolver } from '../did/did-resolver';

export type MethodHandler = (
  ctx: Context,
  message: MessageJson,
  messageStore: MessageStore,
  didResolver: DIDResolver) => Promise<MessageReply>;

export interface Interface {
  methodHandlers: MethodHandler[];
  schemas: { [key:string]: object };
}