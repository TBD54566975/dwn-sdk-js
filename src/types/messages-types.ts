import type { Readable } from 'readable-stream';
import type { AuthorizationModel, GenericMessage, GenericMessageReply } from './message-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';
import type { PaginationCursor, RangeCriterion } from './query-types.js';

/**
 * filters used when filtering for any type of Message across interfaces
 */
export type MessagesFilter = {
  interface?: string;
  method?: string;
  protocol?: string;
  messageTimestamp?: RangeCriterion;
};

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

export type MessagesQueryDescriptor = {
  interface: DwnInterfaceName.Messages;
  method: DwnMethodName.Query;
  messageTimestamp: string;
  filters: MessagesFilter[];
  cursor?: PaginationCursor;
};

export type MessagesQueryMessage = GenericMessage & {
  authorization: AuthorizationModel;
  descriptor: MessagesQueryDescriptor;
};

export type MessagesQueryReply = GenericMessageReply & {
  entries?: string[];
  cursor?: PaginationCursor;
};
