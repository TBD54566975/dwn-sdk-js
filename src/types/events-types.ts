import type { MessageEvent } from './subscriptions.js';
import type { AuthorizationModel, GenericMessage, GenericMessageReply, MessageSubscription } from './message-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';
import type { PaginationCursor, RangeCriterion } from './query-types.js';
/**
 * filters used when filtering for any type of Message across interfaces
 */
export type EventsFilter = {
  interface?: string;
  method?: string;
  protocol?: string;
  messageTimestamp?: RangeCriterion;
};

export type MessageSubscriptionHandler = (event: MessageEvent) => void;

export type EventsSubscribeMessageOptions = {
  subscriptionHandler: MessageSubscriptionHandler;
};

export type EventsSubscribeMessage = {
  authorization: AuthorizationModel;
  descriptor: EventsSubscribeDescriptor;
};

export type EventsSubscribeReply = GenericMessageReply & {
  subscription?: MessageSubscription;
};

export type EventsSubscribeDescriptor = {
  interface: DwnInterfaceName.Events;
  method: DwnMethodName.Subscribe;
  messageTimestamp: string;
  filters: EventsFilter[];
};

export type EventsQueryDescriptor = {
  interface: DwnInterfaceName.Events;
  method: DwnMethodName.Query;
  messageTimestamp: string;
  filters: EventsFilter[];
  cursor?: PaginationCursor;
};

export type EventsQueryMessage = GenericMessage & {
  authorization: AuthorizationModel;
  descriptor: EventsQueryDescriptor;
};

export type EventsQueryReply = GenericMessageReply & {
  entries?: string[];
  cursor?: PaginationCursor;
};