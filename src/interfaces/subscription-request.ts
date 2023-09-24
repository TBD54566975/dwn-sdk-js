
import type { SubscriptionFilter, SubscriptionsRequestDescriptor, SubscriptionRequestMessage } from '../types/subscriptions-request.js';
import type { SignatureInput } from '../types/jws-types.js';
import type { GenericMessage } from '../types/message-types.js';
import { validateAuthorizationIntegrity } from '../core/auth.js';
import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { DwnInterfaceName, DwnMethodName } from '../core/message.js';

import { Message } from '../core/message.js';
import { Subscriptions } from '../utils/subscriptions.js';
import { removeUndefinedProperties } from '../utils/object.js';

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

}