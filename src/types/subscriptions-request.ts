import type { DateSort } from '../interfaces/records-query.js';
import type { EncryptionAlgorithm } from '../utils/encryption.js';
import type { GeneralJws } from './jws-types.js';
import type { GenericMessageReply } from '../core/message-reply.js';
import type { KeyDerivationScheme } from '../utils/hd-key.js';
import type { PublicJwk } from './jose-types.js';
import type { Readable } from 'readable-stream';
import type { BaseAuthorizationPayload, GenericMessage } from './message-types.js';
import type { RangeCriterion } from './records-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../core/message.js';
import { EventMessageI, EventType } from './event-types.js';
import { EventStreamI } from '../event-log/event-stream.js';

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
    eventType: EventType;
    type? : string; // event type. i.e LOG, PROCESS, EVENT
    attester?: string;
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

  export type EventMessageReply = GenericMessageReply & {
    event?: EventMessageI<any>, 
  };