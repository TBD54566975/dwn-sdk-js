import type { Context } from '../types';
import type { JsonMessage } from '../messages/types';
import type { MessageStore } from '../store/message-store';
import type { MessageResult } from '../response/message-result';

import { DIDResolver } from '../did/did-resolver';

export type MethodHandler = (
  ctx: Context,
  message: JsonMessage,
  messageStore: MessageStore,
  didResolver: DIDResolver) => Promise<MessageResult>;

export interface Interface {
  methodHandlers: MethodHandler[];
  schemas: { [key:string]: object };
}