import type { MessageEvent } from './subscriptions.js';
import type { MessagesFilter } from './messages-types.js';
import type { AuthorizationModel, GenericMessageReply, MessageSubscription } from './message-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

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
  filters: MessagesFilter[];
};