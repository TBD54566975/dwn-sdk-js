import type { GenericMessageReply } from '../core/message-reply.js';
import type { ProtocolsQueryFilter } from './protocols-types.js';
import type { RangeCriterion } from './query-types.js';
import type { RecordsFilter } from './records-types.js';
import type { AuthorizationModel, GenericMessage } from './message-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export type EventsFilter = {
  method?: string;
  interface?: string;
  messageTimestamp?: RangeCriterion;
};

// We only allow filtering for events by immutable properties, the omitted properties could be different per subsequent writes.
export type EventsRecordsFilter = Omit<RecordsFilter, 'author' | 'attester' | 'published' | 'dataSize' | 'dataCid' | 'datePublished' | 'dateUpdated' >;

export type EventsQueryFilter = EventsFilter | EventsRecordsFilter | ProtocolsQueryFilter;

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