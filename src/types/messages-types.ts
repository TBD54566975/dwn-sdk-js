import type { GenericMessageReply } from '../core/message-reply.js';
import type { AuthorizationModel, GenericMessage } from './message-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export type MessagesGetDescriptor = {
  interface : DwnInterfaceName.Messages;
  method: DwnMethodName.Get;
  messageCids: string[];
  messageTimestamp: string;
};

export type MessagesGetMessage = GenericMessage & {
  authorization: AuthorizationModel; // overriding `GenericMessage` with `authorization` being required
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