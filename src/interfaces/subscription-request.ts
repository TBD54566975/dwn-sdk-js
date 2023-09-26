import type { EventMessage } from './event-create.js';
import type { EventMessageI } from '../types/event-types.js';
import type { EventStreamI } from '../event-log/event-stream.js';
import type { GenericMessage } from '../types/message-types.js';
import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { Message } from '../core/message.js';
import type { MessageStore } from '../index.js';
import { removeUndefinedProperties } from '../utils/object.js';
import type { SignatureInput } from '../types/jws-types.js';
import { Subscriptions } from '../utils/subscriptions.js';
import { SubscriptionsGrantAuthorization } from '../core/subscriptions-grant-authorization.js';
import { validateAuthorizationIntegrity } from '../core/auth.js';

import { DwnInterfaceName, DwnMethodName } from '../core/message.js';
import type { SubscriptionFilter, SubscriptionRequestMessage, SubscriptionsRequestDescriptor } from '../types/subscriptions-request.js';

export type SubscriptionRequestOptions = {
  filter?: SubscriptionFilter;
  date?: string;
  authorizationSignatureInput?: SignatureInput;
  permissionsGrantId?: string;
};

export class SubscriptionRequest extends Message<SubscriptionRequestMessage> {

  public static async parse(message: SubscriptionRequestMessage): Promise<SubscriptionRequest> {
    if (message.authorization !== undefined) {
      await validateAuthorizationIntegrity(message as GenericMessage);
    }
    const subscriptionRequest = new SubscriptionRequest(message);
    return subscriptionRequest;
  }

  /**
   * Creates a SubscriptionRequest message.
   *
   * @throws {DwnError} when a combination of required SubscriptionRequestOptions are missing
   */
  public static async create(options: SubscriptionRequestOptions): Promise<SubscriptionRequest> {
    const { filter, authorizationSignatureInput, permissionsGrantId } = options;
    const currentTime = getCurrentTimeInHighPrecision();

    const descriptor: SubscriptionsRequestDescriptor = {
      interface        : DwnInterfaceName.Subscriptions,
      method           : DwnMethodName.Request,
      scope            : Subscriptions.normalizeFilter(filter),
      messageTimestamp : options.date ?? currentTime
    };

    removeUndefinedProperties(descriptor);

    // only generate the `authorization` property if signature input is given
    let authorization = undefined;
    if (authorizationSignatureInput !== undefined) {
      authorization = await Message.signAsAuthorization(descriptor, authorizationSignatureInput, permissionsGrantId);
    }
    const message: SubscriptionRequestMessage = { descriptor, authorization };
    Message.validateJsonSchema(message);
    return new SubscriptionRequest(message);
  }

  // TODO: @androsk add scoping for protocls support
  public async authorize(tenant: string, eventStream: EventStreamI, messageStore: MessageStore): Promise<void> {
    if ( tenant === this.author ) { // if the eventStream owner is also the tenant, access is granted always.
      return;
    } else if (this.author !== undefined && this.authorizationPayload?.permissionsGrantId !== undefined) {
      await SubscriptionsGrantAuthorization.authorizeSubscribe(tenant, this, this.author, messageStore);
    } else {
      throw new Error('message failed authorization');
    }
  }

  public async authorizeEvent(tenant: string, event: EventMessage, messageStore: MessageStore) : Promise<void> {
    if (tenant == this.author) {
      return;
    } else if ( this.author !== undefined && this.authorizationPayload?.permissionsGrantId !== undefined ){
      await SubscriptionsGrantAuthorization.authorizeEvent(tenant, this, event, messageStore, this.author);
    } else {
      throw new Error('message failed authorization');
    }
  }
}

export type CreateEventOptions = {
  messageTimestamp: string;
  authorization: string;
  author: string;
  event: EventMessageI<any>;
  authorizationSignatureInput?: SignatureInput;
};
