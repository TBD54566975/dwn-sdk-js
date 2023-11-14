import type { DataStore } from '../types/data-store.js';
import type { DidResolver } from '../did/did-resolver.js';
import type { MessageStore } from '../types//message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { Filter, GenericMessage, MessageSort } from '../types/message-types.js';
import type { RecordsQueryMessage, RecordsQueryReply, RecordsWriteMessageWithOptionalEncodedData } from '../types/records-types.js';

import { authenticate } from '../core/auth.js';
import { DateSort } from '../types/records-types.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { ProtocolAuthorization } from '../core/protocol-authorization.js';
import { Records } from '../utils/records.js';
import { RecordsQuery } from '../interfaces/records-query.js';
import { SortOrder } from '../types/message-types.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export class RecordsQueryHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private messageStore: MessageStore, private dataStore: DataStore) { }

  public async handle({
    tenant,
    message
  }: {tenant: string, message: RecordsQueryMessage}): Promise<RecordsQueryReply> {
    let recordsQuery: RecordsQuery;
    try {
      recordsQuery = await RecordsQuery.parse(message);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }

    let recordsWrites: RecordsWriteMessageWithOptionalEncodedData[];
    let cursor: string|undefined;
    // if this is an anonymous query and the filter supports published records, query only published records
    if (RecordsQueryHandler.filterIncludesPublishedRecords(recordsQuery) && recordsQuery.author === undefined) {
      const results = await this.fetchPublishedRecords(tenant, recordsQuery);
      recordsWrites = results.messages as RecordsWriteMessageWithOptionalEncodedData[];
      cursor = results.cursor;
    } else {
      // authentication and authorization
      try {
        await authenticate(message.authorization!, this.didResolver);

        // Only run protocol authz if message deliberately invokes it
        if (RecordsQueryHandler.shouldProtocolAuthorizeQuery(recordsQuery)) {
          await ProtocolAuthorization.authorizeQuery(tenant, recordsQuery, this.messageStore);
        }
      } catch (e) {
        return messageReplyFromError(e, 401);
      }

      if (recordsQuery.author === tenant) {
        const results = await this.fetchRecordsAsOwner(tenant, recordsQuery);
        recordsWrites = results.messages as RecordsWriteMessageWithOptionalEncodedData[];
        cursor = results.cursor;
      } else {
        const results = await this.fetchRecordsAsNonOwner(tenant, recordsQuery);
        recordsWrites = results.messages as RecordsWriteMessageWithOptionalEncodedData[];
        cursor = results.cursor;
      }
    }

    return {
      status  : { code: 200, detail: 'OK' },
      entries : recordsWrites,
      cursor
    };
  }

  /**
   * Convert an incoming DateSort to a sort type accepted by MessageStore
   * Defaults to 'dateCreated' in Descending order if no sort is supplied.
   *
   * @param dateSort the optional DateSort from the RecordsQuery message descriptor.
   * @returns {MessageSort} for MessageStore sorting.
   */
  private convertDateSort(dateSort?: DateSort): MessageSort {
    switch (dateSort) {
    case DateSort.CreatedAscending:
      return { dateCreated: SortOrder.Ascending };
    case DateSort.CreatedDescending:
      return { dateCreated: SortOrder.Descending };
    case DateSort.PublishedAscending:
      return { datePublished: SortOrder.Ascending };
    case DateSort.PublishedDescending:
      return { datePublished: SortOrder.Descending };
    default:
      return { dateCreated: SortOrder.Ascending };
    }
  }

  /**
   * Fetches the records as the owner of the DWN with no additional filtering.
   */
  private async fetchRecordsAsOwner(
    tenant: string,
    recordsQuery: RecordsQuery
  ): Promise<{ messages: GenericMessage[], cursor?: string }> {
    const { dateSort, filter, pagination } = recordsQuery.message.descriptor;

    // fetch all published records matching the query
    const queryFilter = {
      ...Records.convertFilter(filter),
      interface         : DwnInterfaceName.Records,
      method            : DwnMethodName.Write,
      isLatestBaseState : true
    };

    const messageSort = this.convertDateSort(dateSort);
    return this.messageStore.query(tenant, [ queryFilter ], messageSort, pagination);
  }

  /**
   * Fetches the records as a non-owner.
   *
   * Filters can support returning both published and unpublished records,
   * as well as explicitly only published or only unpublished records.
   *
   * A) BOTH published and unpublished:
   *    1. published records; and
   *    2. unpublished records intended for the query author (where `recipient` is the query author); and
   *    3. unpublished records authorized by a protocol rule.
   *
   * B) PUBLISHED:
   *    1. only published records;
   *
   * C) UNPUBLISHED:
   *    1. unpublished records intended for the query author (where `recipient` is the query author); and
   *    2. unpublished records authorized by a protocol rule.
   *
   */
  private async fetchRecordsAsNonOwner(
    tenant: string, recordsQuery: RecordsQuery
  ): Promise<{ messages: GenericMessage[], cursor?: string }> {
    const { dateSort, pagination } = recordsQuery.message.descriptor;
    const filters = [];

    if (RecordsQueryHandler.filterIncludesPublishedRecords(recordsQuery)) {
      filters.push(RecordsQueryHandler.buildPublishedRecordsFilter(recordsQuery));
    }

    if (RecordsQueryHandler.filterIncludesUnpublishedRecords(recordsQuery)) {
      filters.push(RecordsQueryHandler.buildUnpublishedRecordsByQueryAuthorFilter(recordsQuery));

      const recipientFilter = recordsQuery.message.descriptor.filter.recipient;
      if (recipientFilter === undefined || recipientFilter === recordsQuery.author) {
        filters.push(RecordsQueryHandler.buildUnpublishedRecordsForQueryAuthorFilter(recordsQuery));
      }

      if (RecordsQueryHandler.shouldProtocolAuthorizeQuery(recordsQuery)) {
        filters.push(RecordsQueryHandler.buildUnpublishedProtocolAuthorizedRecordsFilter(recordsQuery));
      }
    }

    const messageSort = this.convertDateSort(dateSort);
    return this.messageStore.query(tenant, filters, messageSort, pagination );
  }

  /**
   * Fetches only published records.
   */
  private async fetchPublishedRecords(
    tenant: string, recordsQuery: RecordsQuery
  ): Promise<{ messages: GenericMessage[], cursor?: string }> {
    const { dateSort, pagination } = recordsQuery.message.descriptor;
    const filter = RecordsQueryHandler.buildPublishedRecordsFilter(recordsQuery);
    const messageSort = this.convertDateSort(dateSort);
    return this.messageStore.query(tenant, [ filter ], messageSort, pagination);
  }

  private static buildPublishedRecordsFilter(recordsQuery: RecordsQuery): Filter {
    // fetch all published records matching the query
    return {
      ...Records.convertFilter(recordsQuery.message.descriptor.filter),
      interface         : DwnInterfaceName.Records,
      method            : DwnMethodName.Write,
      published         : true,
      isLatestBaseState : true
    };
  }

  /**
   * Creates a filter for unpublished records that are intended for the query author (where `recipient` is the author).
   */
  private static buildUnpublishedRecordsForQueryAuthorFilter(recordsQuery: RecordsQuery): Filter {
    // include records where recipient is query author
    return {
      ...Records.convertFilter(recordsQuery.message.descriptor.filter),
      interface         : DwnInterfaceName.Records,
      method            : DwnMethodName.Write,
      recipient         : recordsQuery.author!,
      isLatestBaseState : true,
      published         : false
    };
  }

  /**
   * Creates a filter for unpublished records that are within the specified protocol.
   * Validation that `protocol` and other required protocol-related fields occurs before this method.
   */
  private static buildUnpublishedProtocolAuthorizedRecordsFilter(recordsQuery: RecordsQuery): Filter {
    return {
      ...Records.convertFilter(recordsQuery.message.descriptor.filter),
      interface         : DwnInterfaceName.Records,
      method            : DwnMethodName.Write,
      isLatestBaseState : true,
      published         : false
    };
  }

  /**
   * Creates a filter for only unpublished records where the author is the same as the query author.
   */
  private static buildUnpublishedRecordsByQueryAuthorFilter(recordsQuery: RecordsQuery): Filter {
    // include records where author is the same as the query author
    return {
      ...Records.convertFilter(recordsQuery.message.descriptor.filter),
      author            : recordsQuery.author!,
      interface         : DwnInterfaceName.Records,
      method            : DwnMethodName.Write,
      isLatestBaseState : true,
      published         : false
    };
  }

  /**
   * Determines if ProtocolAuthorization.authorizeQuery should be run and if the corresponding filter should be used.
   */
  private static shouldProtocolAuthorizeQuery(recordsQuery: RecordsQuery): boolean {
    return recordsQuery.signaturePayload!.protocolRole !== undefined;
  }

  /**
   * Checks if the recordQuery filter supports returning published records.
   */
  private static filterIncludesPublishedRecords(recordsQuery: RecordsQuery): boolean {
    const { filter } = recordsQuery.message.descriptor;
    // When `published` and `datePublished` range are both undefined, published records can be returned.
    return filter.datePublished !== undefined || filter.published !== false;
  }

  /**
   * Checks if the recordQuery filter supports returning unpublished records.
   */
  private static filterIncludesUnpublishedRecords(recordsQuery: RecordsQuery): boolean {
    const { filter } = recordsQuery.message.descriptor;
    // When `published` and `datePublished` range are both undefined, unpublished records can be returned.
    if (filter.datePublished === undefined && filter.published === undefined) {
      return true;
    }
    return filter.published === false;
  }
}
