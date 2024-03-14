import type { DidResolver } from '@web5/dids';
import type { Filter } from '../types/query-types.js';
import type { MessageStore } from '../types//message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { EventListener, EventStream } from '../types/subscriptions.js';
import type { RecordEvent, RecordsSubscribeMessage, RecordsSubscribeReply, RecordSubscriptionHandler } from '../types/records-types.js';

import { authenticate } from '../core/auth.js';
import { FilterUtility } from '../utils/filter.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { ProtocolAuthorization } from '../core/protocol-authorization.js';
import { Records } from '../utils/records.js';
import { RecordsSubscribe } from '../interfaces/records-subscribe.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export class RecordsSubscribeHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private messageStore: MessageStore, private eventStream?: EventStream) { }

  public async handle({
    tenant,
    message,
    subscriptionHandler
  }: {
    tenant: string,
    message: RecordsSubscribeMessage,
    subscriptionHandler: RecordSubscriptionHandler,
  }): Promise<RecordsSubscribeReply> {
    if (this.eventStream === undefined) {
      return messageReplyFromError(new DwnError(
        DwnErrorCode.RecordsSubscribeEventStreamUnimplemented,
        'Subscriptions are not supported'
      ), 501);
    }

    let recordsSubscribe: RecordsSubscribe;
    try {
      recordsSubscribe = await RecordsSubscribe.parse(message);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }

    let filters:Filter[] = [];
    // if this is an anonymous subscribe and the filter supports published records, subscribe to only published records
    if (Records.filterIncludesPublishedRecords(recordsSubscribe.message.descriptor.filter) && recordsSubscribe.author === undefined) {
      // build filters for a stream of published records
      filters = [ RecordsSubscribeHandler.buildPublishedRecordsFilter(recordsSubscribe) ];
      // delete the undefined authorization property else the code will encounter the following IPLD issue when attempting to generate CID:
      // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
      delete message.authorization;
    } else {
      // authentication and authorization
      try {
        await authenticate(message.authorization!, this.didResolver);
        await RecordsSubscribeHandler.authorizeRecordsSubscribe(tenant, recordsSubscribe, this.messageStore);
      } catch (error) {
        return messageReplyFromError(error, 401);
      }

      if (recordsSubscribe.author === tenant) {
        // if the subscribe author is the tenant, filter as owner.
        filters = await RecordsSubscribeHandler.filterAsOwner(recordsSubscribe);
      } else {
        // otherwise build filters based on published records, permissions, or protocol rules
        filters = await RecordsSubscribeHandler.filterAsNonOwner(recordsSubscribe);
      }
    }

    const listener: EventListener = (eventTenant, event, eventIndexes):void => {
      if (tenant === eventTenant && FilterUtility.matchAnyFilter(eventIndexes, filters)) {
        // the filters check for interface and method
        // if matched the message is either a `RecordsWriteMessage` or `RecordsDeleteMessage` so we cast the event to a `RecordEvent`
        subscriptionHandler(event as RecordEvent);
      }
    };

    const messageCid = await Message.getCid(message);
    const subscription = await this.eventStream.subscribe(tenant, messageCid, listener);
    return {
      status: { code: 200, detail: 'OK' },
      subscription
    };
  }

  /**
   * Subscribe to records as the owner of the DWN with no additional filtering.
   */
  private static async filterAsOwner(RecordsSubscribe: RecordsSubscribe): Promise<Filter[]> {
    const { filter } = RecordsSubscribe.message.descriptor;

    const subscribeFilter = {
      ...Records.convertFilter(filter),
      interface : DwnInterfaceName.Records,
      method    : [ DwnMethodName.Write, DwnMethodName.Delete ], // we filter for both write and delete so that subscriber can update state.
    };

    return [ subscribeFilter ];
  }

  /**
   * Creates filters in order to subscribe to records as a non-owner.
   *
   * Filters can support emitting messages for both published and unpublished records,
   * as well as explicitly only published or only unpublished records.
   *
   * A) BOTH published and unpublished:
   *    1. published records; and
   *    2. unpublished records intended for the subscription author (where `recipient` is the subscription author); and
   *    3. unpublished records authorized by a protocol rule.
   *
   * B) PUBLISHED:
   *    1. only published records;
   *
   * C) UNPUBLISHED:
   *    1. unpublished records intended for the subscription author (where `recipient` is the subscription author); and
   *    2. unpublished records authorized by a protocol rule.
   */
  private static async filterAsNonOwner(
    recordsSubscribe: RecordsSubscribe
  ): Promise<Filter[]> {
    const filters:Filter[] = [];
    const { filter } = recordsSubscribe.message.descriptor;
    if (Records.filterIncludesPublishedRecords(filter)) {
      filters.push(RecordsSubscribeHandler.buildPublishedRecordsFilter(recordsSubscribe));
    }

    if (Records.filterIncludesUnpublishedRecords(filter)) {
      filters.push(RecordsSubscribeHandler.buildUnpublishedRecordsBySubscribeAuthorFilter(recordsSubscribe));

      const recipientFilter = recordsSubscribe.message.descriptor.filter.recipient;
      if (recipientFilter === undefined || recipientFilter === recordsSubscribe.author) {
        filters.push(RecordsSubscribeHandler.buildUnpublishedRecordsForSubscribeAuthorFilter(recordsSubscribe));
      }

      if (Records.shouldProtocolAuthorize(recordsSubscribe.signaturePayload!)) {
        filters.push(RecordsSubscribeHandler.buildUnpublishedProtocolAuthorizedRecordsFilter(recordsSubscribe));
      }
    }
    return filters;
  }

  /**
   * Creates a filter for all published records matching the subscribe
   */
  private static buildPublishedRecordsFilter(recordsSubscribe: RecordsSubscribe): Filter {
    return {
      ...Records.convertFilter(recordsSubscribe.message.descriptor.filter),
      interface : DwnInterfaceName.Records,
      method    : [ DwnMethodName.Write, DwnMethodName.Delete ],
      published : true,
    };
  }

  /**
   * Creates a filter for unpublished records that are intended for the subscribe author (where `recipient` is the author).
   */
  private static buildUnpublishedRecordsForSubscribeAuthorFilter(recordsSubscribe: RecordsSubscribe): Filter {
    // include records where recipient is subscribe author
    return {
      ...Records.convertFilter(recordsSubscribe.message.descriptor.filter),
      interface : DwnInterfaceName.Records,
      method    : [ DwnMethodName.Write, DwnMethodName.Delete ],
      recipient : recordsSubscribe.author!,
      published : false
    };
  }

  /**
   * Creates a filter for unpublished records that are within the specified protocol.
   * Validation that `protocol` and other required protocol-related fields occurs before this method.
   */
  private static buildUnpublishedProtocolAuthorizedRecordsFilter(recordsSubscribe: RecordsSubscribe): Filter {
    return {
      ...Records.convertFilter(recordsSubscribe.message.descriptor.filter),
      interface : DwnInterfaceName.Records,
      method    : [ DwnMethodName.Write, DwnMethodName.Delete ],
      published : false
    };
  }

  /**
   * Creates a filter for only unpublished records where the author is the same as the subscribe author.
   */
  private static buildUnpublishedRecordsBySubscribeAuthorFilter(recordsSubscribe: RecordsSubscribe): Filter {
    // include records where author is the same as the subscribe author
    return {
      ...Records.convertFilter(recordsSubscribe.message.descriptor.filter),
      author    : recordsSubscribe.author!,
      interface : DwnInterfaceName.Records,
      method    : [ DwnMethodName.Write, DwnMethodName.Delete ],
      published : false
    };
  }

  /**
   * @param messageStore Used to check if the grant has been revoked.
   */
  public static async authorizeRecordsSubscribe(
    tenant: string,
    recordsSubscribe: RecordsSubscribe,
    messageStore: MessageStore
  ): Promise<void> {

    if (Message.isSignedByAuthorDelegate(recordsSubscribe.message)) {
      await recordsSubscribe.authorizeDelegate(messageStore);
    }

    // NOTE: not all RecordsSubscribe messages require protocol authorization even if the filter includes protocol-related fields,
    // this is because we dynamically filter out records that the caller is not authorized to see.
    // Currently only run protocol authorization if message deliberately invokes a protocol role.
    if (Records.shouldProtocolAuthorize(recordsSubscribe.signaturePayload!)) {
      await ProtocolAuthorization.authorizeQueryOrSubscribe(tenant, recordsSubscribe, messageStore);
    }
  }
}
