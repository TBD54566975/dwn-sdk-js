import type { MethodHandler } from '../types/method-handler.js';
import type { RecordsWriteMessageWithOptionalEncodedData } from '../store/storage-controller.js';
import type { DataStore, DidResolver, Filter, MessageStore } from '../index.js';
import type { EventMessageReply, SubscriptionFilter, SubscriptionRequestMessage, SubscriptionRequestReply } from '../types/subscriptions-request.js';
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
import { EventMessageI, EventType, InterfaceEventMessage } from '../types/event-types.js';
import { EventStream, defaultConfig, type EventStreamI } from '../event-log/event-stream.js';
import { EventMessage } from '../interfaces/event-create.js';

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

        try {
            await subscriptionRequest.authorize(tenant, this.eventStream, this.messageStore);
        } catch (error) {
            return messageReplyFromError(error, 401);
        }

        try {
            const filterFunction = async (event: EventMessage): Promise<boolean> => {
                try {
                    await authenticate(message.authorization!, this.didResolver);
                    await subscriptionRequest.authorizeEvent(tenant, event, this.messageStore);
                    return true;
                } catch (error) {
                    return false;
                }
            };
            
            const synchronousFilterFunction = (event: EventMessage): Promise<boolean> => {
                // Wrap the asynchronous filter function with synchronous behavior
                return filterFunction(event)
                    .then(result => result)
                    .catch(() => false);
            };
            
            const childStream = await this.eventStream.createChild(synchronousFilterFunction);
            await childStream.open();

            const messageReply: SubscriptionRequestReply = {
                status: { code: 200, detail: 'OK' },
                subscription: {
                    emitter: childStream,
                    filter: subscriptionRequest.message.descriptor.scope,
                }
            }
            return messageReply;
        } catch (error) {
            return messageReplyFromError(error, 401);
        }
    };
}
