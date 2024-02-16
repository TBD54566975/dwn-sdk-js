import type { MessageEvent } from './subscriptions.js';
import type { AuthorizationModel, GenericMessage, GenericMessageReply, MessageSubscription } from './message-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';
import type { PaginationCursor, RangeCriterion, RangeFilter } from './query-types.js';
/**
 * filters used when filtering for any type of Message across interfaces
 */
export type EventsMessageFilter = {
  interface?: string;
  method?: string;
  dateUpdated?: RangeCriterion;
};

/**
 * We only allow filtering for events by immutable properties, the omitted properties could be different per subsequent writes.
 */
export type EventsRecordsFilter = {
  recipient?: string;
  protocol?: string;
  protocolPath?: string;
  contextId?: string;
  schema?: string;
  recordId?: string;
  parentId?: string;
  dataFormat?: string;
  dataSize?: RangeFilter;
  dateCreated?: RangeCriterion;
};


/**
 * A union type of the different types of filters a user can use when issuing an EventsQuery or EventsSubscribe
 * TODO: simplify the EventsFilters to only the necessary in order to reduce complexity https://github.com/TBD54566975/dwn-sdk-js/issues/663
 */
export type EventsFilter = EventsMessageFilter | EventsRecordsFilter;

export type EventsGetDescriptor = {
  interface: DwnInterfaceName.Events;
  method: DwnMethodName.Get;
  cursor?: PaginationCursor;
  messageTimestamp: string;
};

export type EventsGetMessage = GenericMessage & {
  authorization: AuthorizationModel; // overriding `GenericMessage` with `authorization` being required
  descriptor: EventsGetDescriptor;
};

export type EventsGetReply = GenericMessageReply & {
  entries?: string[];
  cursor?: PaginationCursor;
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