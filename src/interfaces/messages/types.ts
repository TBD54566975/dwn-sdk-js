import type { BaseMessageReply } from '../../core/message-reply.js';
import type { BaseMessage, Descriptor } from '../../core/types.js';
import type { DwnInterfaceName, DwnMethodName } from '../../core/message.js';

export type MessagesGetDescriptor = Pick<Descriptor, 'interface' | 'method' > & {
  interface : DwnInterfaceName.Messages;
  method: DwnMethodName.Get;
  messageCids: string[];
};

export type MessagesGetMessage = BaseMessage & {
  descriptor: MessagesGetDescriptor;
};

export type MessagesGetReplyEntry = {
  messageCid: string;
  message?: BaseMessage;
  encodedData?: string;
  error?: string;
};

export type MessagesGetReply = BaseMessageReply & {
  messages?: MessagesGetReplyEntry[];
};