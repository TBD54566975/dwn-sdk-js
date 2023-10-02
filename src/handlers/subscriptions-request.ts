import { authenticate } from '../core/auth.js';
import type { EventMessage } from '../interfaces/event-create.js';
import type { EventStreamI } from '../event-log/event-stream.js';
import { messageReplyFromError } from '../core/message-reply.js';
import type { MethodHandler } from '../types/method-handler.js';
import { SubscriptionRequest } from '../interfaces/subscription-request.js';

import type { DataStore, DidResolver, MessageStore } from '../index.js';
import type {
  SubscriptionRequestMessage,
  SubscriptionRequestReply,
} from '../types/subscriptions-request.js';

export class SubscriptionsRequestHandler implements MethodHandler {
  constructor(
    private didResolver: DidResolver,
    private messageStore: MessageStore,
    private dataStore: DataStore,
    private eventStream: EventStreamI
  ) {}

  public async handle({
    tenant,
    message,
  }: {
    tenant: string;
    message: SubscriptionRequestMessage;
  }): Promise<SubscriptionRequestReply> {
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
      await subscriptionRequest.authorize(tenant, this.messageStore);
    } catch (error) {
      return messageReplyFromError(error, 401);
    }

    try {
      const filterFunction = async (event: EventMessage): Promise<boolean> => {
        try {
          await authenticate(event.message.authorization!, this.didResolver);
          await subscriptionRequest.authorizeEvent(
            tenant,
            event,
            this.messageStore
          );
          return true;
        } catch (error) {
          return false;
        }
      };

      const synchronousFilterFunction = async (
        event: EventMessage
      ): Promise<boolean> => {
        // Wrap the asynchronous filter function with synchronous behavior
        try {
          const result = await filterFunction(event);
          // console.log(
          //   "filtering",
          //   event,
          //   "result",
          //   result,
          //   "descriptor",
          //   event.message.descriptor
          // );
          return result;
        } catch {
          return false;
        }
      };

      const childStream = await this.eventStream.createChild(
        synchronousFilterFunction
      );
      await childStream.open();

      const messageReply: SubscriptionRequestReply = {
        status       : { code: 200, detail: 'OK' },
        subscription : {
          emitter : childStream,
          filter  : subscriptionRequest.message.descriptor.scope,
        },
      };
      return messageReply;
    } catch (error) {
      return messageReplyFromError(error, 401);
    }
  }
}
