import type { Readable } from 'readable-stream';
import type { AuthorizationModel, GenericMessage, GenericMessageReply } from './message-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export type MessagesGetDescriptor = {
  interface : DwnInterfaceName.Messages;
  method: DwnMethodName.Get;
  messageCid: string;
  messageTimestamp: string;
};

export type MessagesGetMessage = GenericMessage & {
  authorization: AuthorizationModel; // overriding `GenericMessage` with `authorization` being required
  descriptor: MessagesGetDescriptor;
};

export type MessagesGetReplyEntry = {
  messageCid: string;
  message: (GenericMessage & { data?: Readable });
};

export type MessagesGetReply = GenericMessageReply & {
  entry?: MessagesGetReplyEntry;
};
