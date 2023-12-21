import type { DidResolver } from '../did/did-resolver.js';
import type EventEmitter from 'events';
import type { EventStream } from '../types/event-stream.js';
import type { GenericMessage } from '../types/message-types.js';
import type { MessageStore } from '../types//message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { Filter, KeyValues } from '../types/query-types.js';
import type { RecordsDeleteMessage, RecordsSubscribeMessage, RecordsSubscribeReply, RecordsWriteMessage } from '../types/records-types.js';

import { authenticate } from '../core/auth.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { ProtocolAuthorization } from '../core/protocol-authorization.js';
import { Records } from '../utils/records.js';
import { RecordsDelete } from '../interfaces/records-delete.js';
import { RecordsSubscribe } from '../interfaces/records-subscribe.js';
import { RecordsWrite } from '../interfaces/records-write.js';
import { SubscriptionBase } from '../event-log/subscription.js';
import { Time } from '../utils/time.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export class RecordsSubscribeHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private messageStore: MessageStore, private eventStream: EventStream) { }

  public async handle({
    tenant,
    message
  }: {tenant: string, message: RecordsSubscribeMessage}): Promise<RecordsSubscribeReply> {
    let recordsSubscribe: RecordsSubscribe;
    try {
      recordsSubscribe = await RecordsSubscribe.parse(message);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }
    let filters:Filter[] = [];
    // if this is an anonymous subscribe and the filter supports published records, subscribe to only published records
    if (RecordsSubscribeHandler.filterIncludesPublishedRecords(recordsSubscribe) && recordsSubscribe.author === undefined) {
      // return a stream
      filters = await RecordsSubscribeHandler.subscribePublishedRecords(recordsSubscribe);
    } else {
      // authentication and authorization
      try {
        await authenticate(message.authorization!, this.didResolver);
        await RecordsSubscribeHandler.authorizeRecordsSubscribe(tenant, recordsSubscribe, this.messageStore);
      } catch (error) {
        return messageReplyFromError(error, 401);
      }

      if (recordsSubscribe.author === tenant) {
        filters = await RecordsSubscribeHandler.subscribeAsOwner(recordsSubscribe);
      } else {
        filters = await RecordsSubscribeHandler.subscribeAsNonOwner(recordsSubscribe);
      }
    }

    const subscription = await this.eventStream.subscribe(tenant, message, filters);
    return {
      status: { code: 200, detail: 'OK' },
      subscription
    };
  }

  // 1) owner filters
  // 2) public filters
  // 3) authorized filters
  //    a) protocol authorized
  //    b) grant authorized

  /**
   * Fetches the records as the owner of the DWN with no additional filtering.
   */
  private static async subscribeAsOwner(RecordsSubscribe: RecordsSubscribe): Promise<Filter[]> {
    const { filter } = RecordsSubscribe.message.descriptor;

    const subscribeFilter = {
      ...Records.convertFilter(filter),
      interface : DwnInterfaceName.Records,
      method    : [ DwnMethodName.Write, DwnMethodName.Delete ], // we fetch both write and delete so that subscriber can update state.
    };

    return [subscribeFilter];
  }

  /**
   * Subscribe to records as a non-owner.
   *
   * Filters can support returning both published and unpublished records,
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
   *
   */
  private static async subscribeAsNonOwner(
    recordsSubscribe: RecordsSubscribe
  ): Promise<Filter[]> {
    const filters:Filter[] = [];

    if (RecordsSubscribeHandler.filterIncludesPublishedRecords(recordsSubscribe)) {
      filters.push(RecordsSubscribeHandler.buildPublishedRecordsFilter(recordsSubscribe));
    }

    if (RecordsSubscribeHandler.filterIncludesUnpublishedRecords(recordsSubscribe)) {
      filters.push(RecordsSubscribeHandler.buildUnpublishedRecordsBySubscribeAuthorFilter(recordsSubscribe));

      const recipientFilter = recordsSubscribe.message.descriptor.filter.recipient;
      if (recipientFilter === undefined || recipientFilter === recordsSubscribe.author) {
        filters.push(RecordsSubscribeHandler.buildUnpublishedRecordsForSubscribeAuthorFilter(recordsSubscribe));
      }

      if (RecordsSubscribeHandler.shouldProtocolAuthorizeSubscribe(recordsSubscribe)) {
        filters.push(RecordsSubscribeHandler.buildUnpublishedProtocolAuthorizedRecordsFilter(recordsSubscribe));
      }
    }
    return filters;
  }

  /**
   * Fetches only published records.
   */
  private static async subscribePublishedRecords(
    recordsSubscribe: RecordsSubscribe
  ): Promise<Filter[]> {
    const filter = RecordsSubscribeHandler.buildPublishedRecordsFilter(recordsSubscribe);
    return [filter];
  }

  private static buildPublishedRecordsFilter(recordsSubscribe: RecordsSubscribe): Filter {
    // fetch all published records matching the subscribe
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
   * Determines if ProtocolAuthorization.authorizeSubscribe should be run and if the corresponding filter should be used.
   */
  private static shouldProtocolAuthorizeSubscribe(recordsSubscribe: RecordsSubscribe): boolean {
    return recordsSubscribe.signaturePayload!.protocolRole !== undefined;
  }

  /**
   * Checks if the recordSubscribe filter supports returning published records.
   */
  private static filterIncludesPublishedRecords(recordsSubscribe: RecordsSubscribe): boolean {
    const { filter } = recordsSubscribe.message.descriptor;
    // When `published` and `datePublished` range are both undefined, published records can be returned.
    return filter.datePublished !== undefined || filter.published !== false;
  }

  /**
   * Checks if the recordSubscribe filter supports returning unpublished records.
   */
  private static filterIncludesUnpublishedRecords(recordsSubscribe: RecordsSubscribe): boolean {
    const { filter } = recordsSubscribe.message.descriptor;
    // When `published` and `datePublished` range are both undefined, unpublished records can be returned.
    if (filter.datePublished === undefined && filter.published === undefined) {
      return true;
    }
    return filter.published === false;
  }

  /**
 * @param messageStore Used to check if the grant has been revoked.
 */
  public static async authorizeRecordsSubscribe(
    tenant: string,
    recordsSubscribe: RecordsSubscribe,
    messageStore: MessageStore
  ): Promise<void> {

    if (Message.isSignedByDelegate(recordsSubscribe.message)) {
      await recordsSubscribe.authorizeDelegate(messageStore);
    }

    // Only run protocol authz if message deliberately invokes it
    if (RecordsSubscribeHandler.shouldProtocolAuthorizeSubscribe(recordsSubscribe)) {
      await ProtocolAuthorization.authorizeSubscription(tenant, recordsSubscribe, messageStore);
    }
  }
}

export class RecordsSubscriptionHandler extends SubscriptionBase {
  private recordsSubscribe: RecordsSubscribe;

  private reauthorizationTTL: number;
  private reauthorizationTime?: string;

  constructor(options: {
    id: string,
    tenant: string,
    recordsSubscribe: RecordsSubscribe,
    filters: Filter[],
    eventEmitter: EventEmitter,
    messageStore: MessageStore,
    unsubscribe: () => Promise<void>;
    reauthorizationTTL:number,
  }) {
    const { recordsSubscribe, reauthorizationTTL } = options;
    super({ ...options, message: recordsSubscribe.message });
    this.recordsSubscribe = recordsSubscribe;

    // set reauthorization option, if reauthorizationTTL is zero it will never re-authorize.
    // if reauthorizationTTL is less than zero it will re-authorize with each matching event.
    // otherwise it will re-authorize only after a TTL and reset its timer each time.
    this.reauthorizationTTL = reauthorizationTTL;
    if (this.reauthorizationTTL > 0) {
      this.reauthorizationTime = Time.createOffsetTimestamp({ seconds: this.reauthorizationTTL });
    }
  }

  get shouldAuthorize(): boolean {
    return this.reauthorizationTTL < 0 ||
      this.reauthorizationTime !== undefined && Time.getCurrentTimestamp() >= this.reauthorizationTime;
  }

  private async reauthorize():Promise<void> {
    this.reauthorizationTime = Time.createOffsetTimestamp({ seconds: this.reauthorizationTTL! });
    await RecordsSubscribeHandler.authorizeRecordsSubscribe(this.tenant, this.recordsSubscribe, this.messageStore);
  }

  public static async create(options: {
    tenant: string,
    message: RecordsSubscribeMessage,
    filters: Filter[],
    eventEmitter: EventEmitter,
    messageStore: MessageStore,
    unsubscribe: () => Promise<void>;
    reauthorizationTTL: number
  }): Promise<RecordsSubscriptionHandler> {
    const id = await Message.getCid(options.message);
    const recordsSubscribe = await RecordsSubscribe.parse(options.message);
    return new RecordsSubscriptionHandler({ ...options, id, recordsSubscribe });
  }

  public listener = async (tenant: string, message: GenericMessage, ...indexes: KeyValues[]):Promise<void> => {
    if (this.matchFilter(tenant, ...indexes)) {
      if (this.shouldAuthorize) {
        try {
          await this.reauthorize();
        } catch (error) {
          //todo: check for known authorization errors
          // console.log('reauthorize error', error);
          await this.close();
        }
      }

      if (RecordsWrite.isRecordsWriteMessage(message) || RecordsDelete.isRecordsDeleteMessage(message)) {
        this.eventEmitter.emit(this.eventChannel, message);
      }
    }
  };

  on(handler:(message: RecordsWriteMessage | RecordsDeleteMessage) => void): { off: () => void } {
    this.eventEmitter.on(this.eventChannel, handler);
    return {
      off: (): void => {
        this.eventEmitter.off(this.eventChannel, handler);
      }
    };
  }
};
