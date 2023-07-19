import type { MethodHandler } from '..//types/method-handler.js';
import type { RecordsWriteMessageWithOptionalEncodedData } from '../store/storage-controller.js';
import type { DataStore, DidResolver, MessageStore } from '../index.js';
import type { RecordsQueryMessage, RecordsQueryReply, RecordsQueryReplyEntry, RecordsWriteMessage } from '../types/records-types.js';

import { authenticate } from '../core/auth.js';
import { lexicographicalCompare } from '../utils/string.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { StorageController } from '../store/storage-controller.js';

import { DateSort, RecordsQuery } from '../interfaces/records-query.js';
import { DwnInterfaceName, DwnMethodName } from '../core/message.js';

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

    // if this is an anonymous query, query only published records
    if (recordsQuery.author === undefined) {
      let recordsWrites = await this.fetchPublishedRecords(tenant, recordsQuery);
      recordsWrites = await sortRecords(recordsWrites, recordsQuery.message.descriptor.dateSort);

      const entries = RecordsQueryHandler.removeAuthorization(recordsWrites);
      return {
        status: { code: 200, detail: 'OK' },
        entries
      };
    }

    // authentication
    try {
      await authenticate(message.authorization!, this.didResolver);
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    let recordsWrites: RecordsWriteMessageWithOptionalEncodedData[];
    if (recordsQuery.author === tenant) {
      recordsWrites = await this.fetchRecordsAsOwner(tenant, recordsQuery);
    } else {
      recordsWrites = await this.fetchRecordsAsNonOwner(tenant, recordsQuery);
    }

    recordsWrites = await sortRecords(recordsWrites, recordsQuery.message.descriptor.dateSort);

    const entries = RecordsQueryHandler.removeAuthorization(recordsWrites);

    return {
      status: { code: 200, detail: 'OK' },
      entries
    };
  }

  /**
   * Removes `authorization` property from each and every `RecordsWrite` message given and returns the result as a different array.
   */
  private static removeAuthorization(recordsWriteMessages: RecordsWriteMessageWithOptionalEncodedData[]): RecordsQueryReplyEntry[] {
    const recordsQueryReplyEntries: RecordsQueryReplyEntry[] = [];
    for (const record of recordsWriteMessages) {
      const { authorization: _, ...objectWithRemainingProperties } = record; // a trick to stripping away `authorization`
      recordsQueryReplyEntries.push(objectWithRemainingProperties);
    }

    return recordsQueryReplyEntries;
  }

  /**
   * Fetches the records as the owner of the DWN with no additional filtering.
   */
  private async fetchRecordsAsOwner(tenant: string, recordsQuery: RecordsQuery): Promise<RecordsWriteMessageWithOptionalEncodedData[]> {
    // fetch all published records matching the query
    const filter = {
      ...RecordsQuery.convertFilter(recordsQuery.message.descriptor.filter),
      interface         : DwnInterfaceName.Records,
      method            : DwnMethodName.Write,
      isLatestBaseState : true
    };
    const records = await StorageController.query(this.messageStore, this.dataStore, tenant, filter);
    return records;
  }

  /**
   * Fetches the records as a non-owner, return only:
   * 1. published records; and
   * 2. unpublished records intended for the query author (where `recipient` is the query author)
   */
  private async fetchRecordsAsNonOwner(tenant: string, recordsQuery: RecordsQuery)
    : Promise<RecordsWriteMessageWithOptionalEncodedData[]> {
    const publishedRecords = await this.fetchPublishedRecords(tenant, recordsQuery);
    const unpublishedRecordsByAuthor = await this.fetchUnpublishedRecordsByAuthor(tenant, recordsQuery);

    // the `RecordsQuery` author in addition is allowed to get private records that were meant for them
    let unpublishedRecordsForQueryAuthor: RecordsWriteMessageWithOptionalEncodedData[] = [];
    const recipientFilter = recordsQuery.message.descriptor.filter.recipient;
    if (recipientFilter === undefined || recipientFilter === recordsQuery.author) {
      unpublishedRecordsForQueryAuthor = await this.fetchUnpublishedRecordsForQueryAuthor(tenant, recordsQuery);
    }

    const records = [...publishedRecords, ...unpublishedRecordsByAuthor, ...unpublishedRecordsForQueryAuthor];

    // go through the records and remove duplicates
    // this can happen between `unpublishedRecordsByAuthor` and `unpublishedRecordsForQueryAuthor` when `author` = `recipient`
    const deduplicatedRecords = new Map<string, RecordsWriteMessageWithOptionalEncodedData>();
    for (const record of records) {
      if (!deduplicatedRecords.has(record.recordId)) {
        deduplicatedRecords.set(record.recordId, record);
      }
    }

    return Array.from(deduplicatedRecords.values());
  }

  /**
   * Fetches only published records.
   */
  private async fetchPublishedRecords(tenant: string, recordsQuery: RecordsQuery): Promise<RecordsWriteMessageWithOptionalEncodedData[]> {
    // fetch all published records matching the query
    const filter = {
      ...RecordsQuery.convertFilter(recordsQuery.message.descriptor.filter),
      interface         : DwnInterfaceName.Records,
      method            : DwnMethodName.Write,
      published         : true,
      isLatestBaseState : true
    };
    const publishedRecords = await StorageController.query(this.messageStore, this.dataStore, tenant, filter);
    return publishedRecords;
  }

  /**
   * Fetches unpublished records that are intended for the query author (where `recipient` is the author).
   */
  private async fetchUnpublishedRecordsForQueryAuthor(tenant: string, recordsQuery: RecordsQuery)
    : Promise<RecordsWriteMessageWithOptionalEncodedData[]> {

    // include records where recipient is query author
    const filter = {
      ...RecordsQuery.convertFilter(recordsQuery.message.descriptor.filter),
      interface         : DwnInterfaceName.Records,
      method            : DwnMethodName.Write,
      recipient         : recordsQuery.author!,
      isLatestBaseState : true,
      published         : false
    };
    const unpublishedRecordsForQueryAuthor = await StorageController.query(this.messageStore, this.dataStore, tenant, filter);

    return unpublishedRecordsForQueryAuthor;
  }

  /**
   * Fetches only unpublished records where the author is the same as the query author.
   */
  private async fetchUnpublishedRecordsByAuthor(tenant: string, recordsQuery: RecordsQuery)
    : Promise<RecordsWriteMessageWithOptionalEncodedData[]> {

    // include records where author is the same as the query author
    const filter = {
      ...RecordsQuery.convertFilter(recordsQuery.message.descriptor.filter),
      author            : recordsQuery.author!,
      interface         : DwnInterfaceName.Records,
      method            : DwnMethodName.Write,
      isLatestBaseState : true,
      published         : false
    };
    const unpublishedRecordsForQueryAuthor = await StorageController.query(this.messageStore, this.dataStore, tenant, filter);
    return unpublishedRecordsForQueryAuthor;
  }
}

/**
 * Sorts the given records. There are 4 options for dateSort:
 * 1. createdAscending - Sort in ascending order based on when the message was created
 * 2. createdDescending - Sort in descending order based on when the message was created
 * 3. publishedAscending - If the message is published, sort in asc based on publish date
 * 4. publishedDescending - If the message is published, sort in desc based on publish date
 *
 * If sorting is based on date published, records that are not published are filtered out.
 * @param messages - Messages to be sorted if dateSort is present
 * @param dateSort - Sorting scheme
 * @returns Sorted Messages
 */
async function sortRecords(
  messages: RecordsWriteMessage[],
  dateSort: DateSort = DateSort.CreatedAscending
): Promise<RecordsWriteMessage[]> {
  switch (dateSort) {
  case DateSort.CreatedAscending:
    return messages.sort((a, b) => lexicographicalCompare(a.descriptor.dateCreated, b.descriptor.dateCreated));
  case DateSort.CreatedDescending:
    return messages.sort((a, b) => lexicographicalCompare(b.descriptor.dateCreated, a.descriptor.dateCreated));
  case DateSort.PublishedAscending:
    return messages
      .filter(m => m.descriptor.published)
      .sort((a, b) => lexicographicalCompare(a.descriptor.datePublished!, b.descriptor.datePublished!));
  case DateSort.PublishedDescending:
    return messages
      .filter(m => m.descriptor.published)
      .sort((a, b) => lexicographicalCompare(b.descriptor.datePublished!, a.descriptor.datePublished!));
  }
}
