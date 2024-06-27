import type { MessageEvent } from './subscriptions.js';
import type { Readable } from 'readable-stream';
import type { AuthorizationModel, GenericMessage, GenericMessageReply, MessageSubscription } from './message-types.js';
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

export type MessagesReadDescriptor = {
  interface : DwnInterfaceName.Messages;
  method: DwnMethodName.Read;
  messageCid: string;
  messageTimestamp: string;
};

export type MessagesReadMessage = GenericMessage & {
  authorization: AuthorizationModel; // overriding `GenericMessage` with `authorization` being required
  descriptor: MessagesReadDescriptor;
};

export type MessagesReadReplyEntry = {
  messageCid: string;
  message: (GenericMessage & { data?: Readable });
};

export type MessagesReadReply = GenericMessageReply & {
  entry?: MessagesReadReplyEntry;
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

export type MessageSubscriptionHandler = (event: MessageEvent) => void;

export type MessagesSubscribeMessageOptions = {
  subscriptionHandler: MessageSubscriptionHandler;
};

export type MessagesSubscribeMessage = {
  authorization: AuthorizationModel;
  descriptor: MessagesSubscribeDescriptor;
};

export type MessagesSubscribeReply = GenericMessageReply & {
  subscription?: MessageSubscription;
};

export type MessagesSubscribeDescriptor = {
  interface: DwnInterfaceName.Messages;
  method: DwnMethodName.Subscribe;
  messageTimestamp: string;
  filters: MessagesFilter[];
};
