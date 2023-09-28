import type { EventStreamI } from '../event-log/event-stream.js';
import type { GeneralJws } from './jws-types.js';
import type { GenericMessageReply } from '../core/message-reply.js';
import type { ProtocolsQueryFilter } from './protocols-types.js';

import type { DwnInterfaceName, DwnMethodName } from '../core/message.js';
import type { EventMessageI, EventType } from './event-types.js';
import type { RangeCriterion, RecordsFilter } from './records-types.js';

export type SubscriptionRequestMessage = {
  authorization?: GeneralJws;
  descriptor: SubscriptionsRequestDescriptor;
};

export type SubscriptionRequestReply = GenericMessageReply & {
  subscription?: {
    id?: string;
    grantedFrom?: string;
    grantedTo?: string;
    attestation?: GeneralJws;
    emitter?: EventStreamI;
    filter?: SubscriptionFilter,
  }
};

export type SubscriptionsRequestDescriptor = {
  interface: DwnInterfaceName.Subscriptions;
  method: DwnMethodName.Request;
  scope: SubscriptionFilter;
  messageTimestamp: string;
};

export type SubscriptionFilter = {
    eventType: EventType; // probably will remove this...
    recordFilters?: RecordsFilter;
    protocolFilters?: ProtocolsQueryFilter;
};

export type EventMessageReply = GenericMessageReply & {
    event?: EventMessageI<any>,
  };