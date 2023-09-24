import type { MessageStore } from '../types/message-store.js';
import { SubscriptionRequest } from "../interfaces/subscription-request";
import { GrantAuthorization } from './grant-authorization.js';
import { EventStreamI } from '../event-log/event-stream.js';
import type { PermissionsGrantMessage, SubscriptionPermissionScope } from '../types/permissions-types.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';


export class SubscriptionsGrantAuthorization {

    /**
    * Authorizes the scope of a PermissionsGrant for Subscription.
    * For initial connection setup.
    */
    public static async authorizeSubscribe(
        tenant: string,
        incomingMessage: SubscriptionRequest,
        author: string,
        messageStore: MessageStore,
        eventLog: EventStreamI,
    ): Promise<void> {
        const permissionsGrantMessage = await GrantAuthorization.authorizeGenericMessage(tenant, incomingMessage, author, messageStore);
        SubscriptionsGrantAuthorization.verifyScope(incomingMessage, permissionsGrantMessage);
    }

    /**
    * @param subscriptionRequest The source of the record being authorized.
    */
    private static verifyScope(
        subscriptionRequest: SubscriptionRequest,
        permissionsGrantMessage: PermissionsGrantMessage,
    ): void {
        const grantScope = permissionsGrantMessage.descriptor.scope as SubscriptionPermissionScope;

        if (SubscriptionsGrantAuthorization.isUnrestrictedScope(grantScope)) {
            // scope has no restrictions beyond interface and method. Message is authorized to access any record.
            return;
        } else if (subscriptionRequest.message.descriptor.scope.protocol !== undefined) {
            // authorization of protocol records must have grants that explicitly include the protocol
            SubscriptionsGrantAuthorization.authorizeProtocolRecord(subscriptionRequest, grantScope);
        } else {
            SubscriptionsGrantAuthorization.authorizeFlatRecord(subscriptionRequest, grantScope);
        }
    }

    /**
    * Checks if scope has no restrictions beyond interface and method.
    * Grant-holder is authorized to access any record.
    */
    private static isUnrestrictedScope(grantScope: SubscriptionPermissionScope): boolean {
        return grantScope.protocol === undefined &&
            grantScope.schema === undefined &&
            grantScope.eventType == undefined;
    }

    /**
     * Authorizes a grant scope for a protocol record
     */
    private static authorizeProtocolRecord(
        subscriptionRequest: SubscriptionRequest,
        grantScope: SubscriptionPermissionScope
    ): void {
        // Protocol records must have grants specifying the protocol
        if (grantScope.protocol === undefined) {
            throw new DwnError(
                DwnErrorCode.SubscriptionsGrantAuthorizationScopeNotProtocol,
                'Grant for protocol subscription must specify protocol in its scope'
            );
        }

        // The record's protocol must match the protocol specified in the record
        if (grantScope.protocol !== subscriptionRequest.message.descriptor.scope.protocol) {
            throw new DwnError(
                DwnErrorCode.SubscriptionsGrantAuthorizationScopeProtocolMismatch,
                `Grant scope specifies different protocol than what appears in the subscription`
            );
        }

        // If grant specifies either contextId, check that record is that context
        if (grantScope.contextId !== undefined && grantScope.contextId !== subscriptionRequest.message.descriptor.scope.contextId) {
            throw new DwnError(
                DwnErrorCode.SubscriptionsGrantAuthorizationScopeContextIdMismatch,
                `Grant scope specifies different contextId than what appears in the subscription`
            );
        }

        // If grant specifies protocolPath, check that record is at that protocolPath
        if (grantScope.protocolPath !== undefined && grantScope.protocolPath !== subscriptionRequest.message.descriptor.scope.protocolPath) {
            throw new DwnError(
                DwnErrorCode.SubscriptionsGrantAuthorizationScopeProtocolPathMismatch,
                `Grant scope specifies different protocolPath than what appears in the subscription`
            );
        }
    }

    /**
    * Authorizes a grant scope for a non-protocol record
    */
    private static authorizeFlatRecord(
        subscriptionRequest: SubscriptionRequest,
        grantScope: SubscriptionPermissionScope
    ): void {
        if (grantScope.schema !== undefined) {
            if (grantScope.schema !== subscriptionRequest.message.descriptor.scope.schema) {
                throw new DwnError(
                    DwnErrorCode.RecordsGrantAuthorizationScopeSchema,
                    `Record does not have schema in PermissionsGrant scope with schema '${grantScope.schema}'`
                );
            }
        }
    }
}