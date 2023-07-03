import type { GenericMessage } from './message-types.js';
import type { GenericMessageReply } from '../core/message-reply.js';
import type { DwnInterfaceName, DwnMethodName } from '../core/message.js';

export type MessagesGetDescriptor = {
  interface : DwnInterfaceName.Messages;
  method: DwnMethodName.Get;
  messageCids: string[];
  messageTimestamp: string;
};

export type MessagesGetMessage = GenericMessage & {
  descriptor: MessagesGetDescriptor;
};

export type MessagesGetReplyEntry = {
  messageCid: string;
  message?: GenericMessage;
  encodedData?: string;
  error?: string;
};

export type MessagesGetReply = GenericMessageReply & {
  messages?: MessagesGetReplyEntry[];
};