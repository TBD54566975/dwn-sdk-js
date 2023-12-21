import type { ProtocolsQueryFilter } from './protocols-types.js';
import type { AuthorizationModel, GenericMessage, GenericMessageReply } from './message-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';
import type { PaginationCursor, RangeCriterion, RangeFilter } from './query-types.js';

export type EventsMessageFilter = {
  interface?: string;
  method?: string;
  dateUpdated?: RangeCriterion;
};

// We only allow filtering for events by immutable properties, the omitted properties could be different per subsequent writes.
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

export type EventsFilter = EventsMessageFilter | EventsRecordsFilter | ProtocolsQueryFilter;

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

export type EventsSubscribeMessage = {
  authorization?: AuthorizationModel;
  descriptor: EventsSubscribeDescriptor;
};

export type EventsHandler = (message: GenericMessage) => void;

export type EventsSubscription = {
  id: string;
  on: (handler: EventsHandler) => { off: () => void };
  close: () => Promise<void>;
};

export type EventsSubscribeReply = GenericMessageReply & {
  subscription?: EventsSubscription;
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