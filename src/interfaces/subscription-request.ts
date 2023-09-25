
import type { SubscriptionFilter, SubscriptionsRequestDescriptor, SubscriptionRequestMessage, SubscriptionRequestReply } from '../types/subscriptions-request.js';
import type { SignatureInput } from '../types/jws-types.js';
import type { GenericMessage } from '../types/message-types.js';
import { validateAuthorizationIntegrity } from '../core/auth.js';
import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { DwnInterfaceName, DwnMethodName } from '../core/message.js';
import { SubscriptionsGrantAuthorization } from '../core/subscriptions-grant-authorization.js';

import { Message } from '../core/message.js';
import { Subscriptions } from '../utils/subscriptions.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { EventStream, EventStreamI } from '../event-log/event-stream.js';
import { MessageStore } from '../index.js';
import { ProtocolAuthorization } from '../core/protocol-authorization.js';
import { EventMessageI } from '../types/event-types.js';

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
      interface: DwnInterfaceName.Subscriptions,
      method: DwnMethodName.Request,
      scope: Subscriptions.normalizeFilter(filter),
      messageTimestamp: options.date ?? currentTime
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

  // TODO: andorsk add scoping for protocls support
  public async authorize(tenant: string, eventStream: EventStreamI, messageStore: MessageStore): Promise<void> {
    if ( tenant === this.author ) { // if the eventStream owner is also the tenant, access is granted always. 
      return;
    } else if (this.author !== undefined && this.authorizationPayload?.permissionsGrantId !== undefined) {
      await SubscriptionsGrantAuthorization.authorizeSubscribe(tenant, this, this.author, messageStore, eventStream);
    } else {
      throw new Error('message failed authorization');
    }
  }

  public async authorizeEvent(tenant: string, event: EventMessageI<any>, messageStore: MessageStore) : Promise<void> {
    // checking authorization
    if ( tenant === this.author ) {
      return;
    }

    console.log("checking author and payload")
    if (this.author !== undefined && this.authorizationPayload?.permissionsGrantId !== undefined) {
      console.log("checking subscription grant")
      await SubscriptionsGrantAuthorization.authorizeEvent(tenant, this, event, messageStore) 
    } else {
      console.log("message failed....")
      throw new Error('message failed authorization');
    }
  }

}