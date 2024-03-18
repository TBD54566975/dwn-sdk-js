import type { DataStore } from '../types/data-store.js';
import type { DidResolver } from '@web5/dids';
import type { MessageStore } from '../types//message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { Filter, PaginationCursor } from '../types/query-types.js';
import type { GenericMessage, MessageSort } from '../types/message-types.js';
import type { RecordsQueryMessage, RecordsQueryReply, RecordsQueryReplyEntry } from '../types/records-types.js';

import { authenticate } from '../core/auth.js';
import { DateSort } from '../types/records-types.js';
import { Message } from '../core/message.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { ProtocolAuthorization } from '../core/protocol-authorization.js';
import { Records } from '../utils/records.js';
import { RecordsQuery } from '../interfaces/records-query.js';
import { RecordsWrite } from '../interfaces/records-write.js';
import { SortDirection } from '../types/query-types.js';
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

    let recordsWrites: RecordsQueryReplyEntry[];
    let cursor: PaginationCursor | undefined;
    // if this is an anonymous query and the filter supports published records, query only published records
    if (Records.filterIncludesPublishedRecords(recordsQuery.message.descriptor.filter) && recordsQuery.author === undefined) {
      const results = await this.fetchPublishedRecords(tenant, recordsQuery);
      recordsWrites = results.messages as RecordsQueryReplyEntry[];
      cursor = results.cursor;
    } else {
      // authentication and authorization
      try {
        await authenticate(message.authorization!, this.didResolver);

        await RecordsQueryHandler.authorizeRecordsQuery(tenant, recordsQuery, this.messageStore);
      } catch (e) {
        return messageReplyFromError(e, 401);
      }

      if (recordsQuery.author === tenant) {
        const results = await this.fetchRecordsAsOwner(tenant, recordsQuery);
        recordsWrites = results.messages as RecordsQueryReplyEntry[];
        cursor = results.cursor;
      } else {
        const results = await this.fetchRecordsAsNonOwner(tenant, recordsQuery);
        recordsWrites = results.messages as RecordsQueryReplyEntry[];
        cursor = results.cursor;
      }
    }

    // attach initial write if returned RecordsWrite is not initial write
    for (const recordsWrite of recordsWrites) {
      if (!await RecordsWrite.isInitialWrite(recordsWrite)) {
        const initialWriteQueryResult = await this.messageStore.query(
          tenant,
          [{ recordId: recordsWrite.recordId, isLatestBaseState: false, method: DwnMethodName.Write }]
        );
        const initialWrite = initialWriteQueryResult.messages[0] as RecordsQueryReplyEntry;
        delete initialWrite.encodedData; // defensive measure but technically optional because we do this when an update RecordsWrite takes place
        recordsWrite.initialWrite = initialWrite;
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
      return { dateCreated: SortDirection.Ascending };
    case DateSort.CreatedDescending:
      return { dateCreated: SortDirection.Descending };
    case DateSort.PublishedAscending:
      return { datePublished: SortDirection.Ascending };
    case DateSort.PublishedDescending:
      return { datePublished: SortDirection.Descending };
    default:
      return { dateCreated: SortDirection.Ascending };
    }
  }

  /**
   * Fetches the records as the owner of the DWN with no additional filtering.
   */
  private async fetchRecordsAsOwner(
    tenant: string,
    recordsQuery: RecordsQuery
  ): Promise<{ messages: GenericMessage[], cursor?: PaginationCursor }> {
    const { dateSort, filter, pagination } = recordsQuery.message.descriptor;
    // fetch all published records matching the query
    const queryFilter = {
      ...Records.convertFilter(filter, dateSort),
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
  ): Promise<{ messages: GenericMessage[], cursor?: PaginationCursor }> {
    const { dateSort, pagination, filter } = recordsQuery.message.descriptor;
    const filters = [];
    if (Records.filterIncludesPublishedRecords(filter)) {
      filters.push(RecordsQueryHandler.buildPublishedRecordsFilter(recordsQuery));
    }

    if (Records.filterIncludesUnpublishedRecords(filter)) {
      filters.push(RecordsQueryHandler.buildUnpublishedRecordsByQueryAuthorFilter(recordsQuery));

      const recipientFilter = recordsQuery.message.descriptor.filter.recipient;
      if (recipientFilter === undefined || recipientFilter === recordsQuery.author) {
        filters.push(RecordsQueryHandler.buildUnpublishedRecordsForQueryAuthorFilter(recordsQuery));
      }

      if (Records.shouldProtocolAuthorize(recordsQuery.signaturePayload!)) {
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
  ): Promise<{ messages: GenericMessage[], cursor?: PaginationCursor }> {
    const { dateSort, pagination } = recordsQuery.message.descriptor;
    const filter = RecordsQueryHandler.buildPublishedRecordsFilter(recordsQuery);
    const messageSort = this.convertDateSort(dateSort);
    return this.messageStore.query(tenant, [ filter ], messageSort, pagination);
  }

  private static buildPublishedRecordsFilter(recordsQuery: RecordsQuery): Filter {
    const { dateSort, filter } = recordsQuery.message.descriptor;
    // fetch all published records matching the query
    return {
      ...Records.convertFilter(filter, dateSort),
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
    const { dateSort, filter } = recordsQuery.message.descriptor;
    // include records where recipient is query author
    return {
      ...Records.convertFilter(filter, dateSort),
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
    const { dateSort, filter } = recordsQuery.message.descriptor;
    return {
      ...Records.convertFilter(filter, dateSort),
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
    const { dateSort, filter } = recordsQuery.message.descriptor;
    // include records where author is the same as the query author
    return {
      ...Records.convertFilter(filter, dateSort),
      author            : recordsQuery.author!,
      interface         : DwnInterfaceName.Records,
      method            : DwnMethodName.Write,
      isLatestBaseState : true,
      published         : false
    };
  }

  /**
   * @param messageStore Used to check if the grant has been revoked.
   */
  private static async authorizeRecordsQuery(
    tenant: string,
    recordsQuery: RecordsQuery,
    messageStore: MessageStore
  ): Promise<void> {

    if (Message.isSignedByAuthorDelegate(recordsQuery.message)) {
      await recordsQuery.authorizeDelegate(messageStore);
    }

    // NOTE: not all RecordsQuery messages require protocol authorization even if the filter includes protocol-related fields,
    // this is because we dynamically filter out records that the caller is not authorized to see.
    // Currently only run protocol authorization if message deliberately invokes a protocol role.
    if (Records.shouldProtocolAuthorize(recordsQuery.signaturePayload!)) {
      await ProtocolAuthorization.authorizeQueryOrSubscribe(tenant, recordsQuery, messageStore);
    }
  }
}
