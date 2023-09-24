import type { MethodHandler } from '../types/method-handler.js';
import type { RecordsWriteMessageWithOptionalEncodedData } from '../store/storage-controller.js';
import type { DataStore, DidResolver, Filter, MessageStore } from '../index.js';
import type { SubscriptionRequestMessage, SubscriptionRequestReply } from '../types/subscriptions-request.js';
import { SubscriptionRequest } from '../interfaces/subscription-request.js';

import { authenticate } from '../core/auth.js';
import { DwnInterfaceName, DwnMethodName } from '../core/message.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { Records } from '../utils/records.js';
import { RecordsRead } from '../interfaces/records-read.js';
import { RecordsWrite } from '../interfaces/records-write.js';
import { DataStream, DwnError, DwnErrorCode, Encoder } from '../index.js';
import { Subscriptions } from '../utils/subscriptions.js';
import { EventType, InterfaceEventMessage } from '../types/event-types.js';
import type { EventStreamI } from '../event-log/event-stream.js';

export class SubscriptionsRequestHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private messageStore: MessageStore, private dataStore: DataStore, private eventStream: EventStreamI) { }

  public async handle({
    tenant,
    message
  }: { tenant: string, message: SubscriptionRequestMessage }): Promise<SubscriptionRequestReply> {

    let subscriptionRequest: SubscriptionRequest;
    try {
        subscriptionRequest = await SubscriptionRequest.parse(message);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }

    // authentication
    try {
      if (subscriptionRequest.author !== undefined) {
        await authenticate(message.authorization!, this.didResolver);
      }
    } catch (e) {
      return messageReplyFromError(e, 401);
    }    
    
    // store message
    const { scope, ...propertiesToIndex } = message.descriptor;
    const indexes: { [key: string]: string } = {
      ...propertiesToIndex,
      author: subscriptionRequest.author!,
    };

    const messageCid = await Message.getCid(message);
    const existingMessage = await this.messageStore.get(tenant, messageCid);
    if (existingMessage === undefined) {
      await this.messageStore.put(tenant, message, indexes);
    //   await this.eventLog.append(tenant, messageCid); // append to event stream
    }

    const messageReply: SubscriptionRequestReply ={
      status : { code: 200, detail: 'OK' },
      subscription : {
        id: messageCid,
      }
    };

    return messageReply;
  };
}
