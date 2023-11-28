import type { GenericMessageReply } from '../core/message-reply.js';
import type { ProtocolsQueryFilter } from './protocols-types.js';
import type { RangeCriterion } from './query-types.js';
import type { AuthorizationModel, GenericMessage } from './message-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export type EventsMessageFilter = {
  author?: string;
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
  dateCreated?: RangeCriterion;
};


export type EventsQueryFilter = EventsMessageFilter | EventsRecordsFilter | ProtocolsQueryFilter;

export type EventsGetDescriptor = {
  interface : DwnInterfaceName.Events;
  method: DwnMethodName.Get;
  cursor?: string;
  messageTimestamp: string;
};

export type EventsGetMessage = GenericMessage & {
  authorization: AuthorizationModel; // overriding `GenericMessage` with `authorization` being required
  descriptor: EventsGetDescriptor;
};

export type EventsGetReply = GenericMessageReply & {
  events?: string[];
};

export type EventsQueryDescriptor = {
  interface: DwnInterfaceName.Events;
  method: DwnMethodName.Query;
  messageTimestamp: string;
  filters: EventsQueryFilter[];
  cursor?: string;
};

export type EventsQueryMessage = GenericMessage & {
  authorization: AuthorizationModel;
  descriptor: EventsQueryDescriptor;
};

export type EventsQueryReply = GenericMessageReply & {
  events?: string[];
};