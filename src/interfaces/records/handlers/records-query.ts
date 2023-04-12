import type { MethodHandler } from '../../types.js';
import type { DataStore, DidResolver, MessageStore } from '../../../index.js';
import type { RecordsQueryMessage, RecordsQueryReplyEntry, RecordsWriteMessage } from '../types.js';

import { authenticate } from '../../../core/auth.js';
import { lexicographicalCompare } from '../../../utils/string.js';
import { MessageReply } from '../../../core/message-reply.js';
import type { RecordsWriteMessageWithOptionalEncodedData } from '../../../store/storage-controller.js';
import { StorageController } from '../../../store/storage-controller.js';

import { DateSort, RecordsQuery } from '../messages/records-query.js';
import { DwnInterfaceName, DwnMethodName } from '../../../core/message.js';

export class RecordsQueryHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private messageStore: MessageStore, private dataStore: DataStore) { }

  public async handle({
    tenant,
    message
  }: {tenant: string, message: RecordsQueryMessage}): Promise<MessageReply> {
    let recordsQuery: RecordsQuery;
    try {
      recordsQuery = await RecordsQuery.parse(message);
    } catch (e) {
      return MessageReply.fromError(e, 400);
    }

    try {
      await authenticate(message.authorization, this.didResolver);
      await recordsQuery.authorize(tenant);
    } catch (e) {
      return MessageReply.fromError(e, 401);
    }

    let records: RecordsWriteMessageWithOptionalEncodedData[];
    if (recordsQuery.author === tenant) {
      records = await this.fetchRecordsAsOwner(tenant, recordsQuery);
    } else {
      records = await this.fetchRecordsAsNonOwner(tenant, recordsQuery);
    }

    // sort if `dataSort` is specified
    if (recordsQuery.message.descriptor.dateSort) {
      records = await sortRecords(records, recordsQuery.message.descriptor.dateSort);
    }

    // strip away `authorization` property for each record before responding
    const entries: RecordsQueryReplyEntry[] = [];
    for (const record of records) {
      const { authorization: _, ...objectWithRemainingProperties } = record; // a trick to stripping away `authorization`
      entries.push(objectWithRemainingProperties);
    }

    return new MessageReply({
      status: { code: 200, detail: 'OK' },
      entries
    });
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
   * 2. unpublished records intended for the requester (where `recipient` is the requester)
   */
  private async fetchRecordsAsNonOwner(tenant: string, recordsQuery: RecordsQuery)
    : Promise<RecordsWriteMessageWithOptionalEncodedData[]> {
    const publishedRecords = await this.fetchPublishedRecords(tenant, recordsQuery);
    const unpublishedRecordsForRequester = await this.fetchUnpublishedRecordsForRequester(tenant, recordsQuery);
    const unpublishedRecordsByRequester = await this.fetchUnpublishedRecordsByRequester(tenant, recordsQuery);
    const records = [...publishedRecords, ...unpublishedRecordsForRequester, ...unpublishedRecordsByRequester];
    return records;
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
   * Fetches only unpublished records that are intended for the requester (where `recipient` is the requester).
   */
  private async fetchUnpublishedRecordsForRequester(tenant: string, recordsQuery: RecordsQuery)
    : Promise<RecordsWriteMessageWithOptionalEncodedData[]> {

    // include records where recipient is requester
    const filter = {
      ...RecordsQuery.convertFilter(recordsQuery.message.descriptor.filter),
      interface         : DwnInterfaceName.Records,
      method            : DwnMethodName.Write,
      // TODO: `recordsQuery.author` cannot be undefined until #299 is implemented (https://github.com/TBD54566975/dwn-sdk-js/issues/299)
      recipient         : recordsQuery.author!,
      isLatestBaseState : true,
      published         : false
    };
    const unpublishedRecordsForRequester = await StorageController.query(this.messageStore, this.dataStore, tenant, filter);
    return unpublishedRecordsForRequester;
  }

  /**
   * Fetches only unpublished records that are authored by the requester.
   */
  private async fetchUnpublishedRecordsByRequester(tenant: string, recordsQuery: RecordsQuery)
    : Promise<RecordsWriteMessageWithOptionalEncodedData[]> {

    // include records where recipient is requester
    const filter = {
      ...RecordsQuery.convertFilter(recordsQuery.message.descriptor.filter),
      // TODO: `recordsQuery.author` cannot be undefined until #299 is implemented (https://github.com/TBD54566975/dwn-sdk-js/issues/299)
      author            : recordsQuery.author!,
      interface         : DwnInterfaceName.Records,
      method            : DwnMethodName.Write,
      isLatestBaseState : true,
      published         : false
    };
    const unpublishedRecordsForRequester = await StorageController.query(this.messageStore, this.dataStore, tenant, filter);
    return unpublishedRecordsForRequester;
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
  dateSort: DateSort
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
