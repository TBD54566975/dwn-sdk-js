import type { MethodHandler } from '../../types.js';
import type { RecordsQueryMessage, RecordsWriteMessage } from '../types.js';

import { authenticate } from '../../../core/auth.js';
import type { BaseMessage } from '../../../core/types.js';
import { lexicographicalCompare } from '../../../utils/string.js';
import { MessageReply } from '../../../core/message-reply.js';
import { MessageStore } from '../../../store/message-store.js';

import { DateSort, RecordsQuery } from '../messages/records-query.js';
import { DwnInterfaceName, DwnMethodName } from '../../../core/message.js';

export const handleRecordsQuery: MethodHandler = async ({
  tenant,
  message,
  messageStore,
  didResolver
}): Promise<MessageReply> => {
  let recordsQuery: RecordsQuery;
  try {
    recordsQuery = await RecordsQuery.parse(message as RecordsQueryMessage);
  } catch (e) {
    return new MessageReply({
      status: { code: 400, detail: e.message }
    });
  }

  try {
    await authenticate(message.authorization, didResolver);
    await recordsQuery.authorize(tenant);
  } catch (e) {
    return new MessageReply({
      status: { code: 401, detail: e.message }
    });
  }

  let records: BaseMessage[];
  if (recordsQuery.author === tenant) {
    records = await fetchRecordsAsOwner(tenant, recordsQuery, messageStore);
  } else {
    records = await fetchRecordsAsNonOwner(tenant, recordsQuery, messageStore);
  }

  // sort if `dataSort` is specified
  if (recordsQuery.message.descriptor.dateSort) {
    records = await sortRecords(records, recordsQuery.message.descriptor.dateSort);
  }

  // strip away `authorization` property for each record before responding
  const entries = [];
  for (const record of records) {
    const recordDuplicate = { ...record };
    delete recordDuplicate.authorization;
    entries.push(recordDuplicate);
  }

  return new MessageReply({
    status: { code: 200, detail: 'OK' },
    entries
  });
};
/**
 * Fetches the records as the owner of the DWN with no additional filtering.
 */
async function fetchRecordsAsOwner(tenant: string, recordsQuery: RecordsQuery, messageStore: MessageStore): Promise<BaseMessage[]> {
  // fetch all published records matching the query
  const exactCriteria = RecordsQuery.getExactCriteria(recordsQuery.message.descriptor.filter);
  const completeExactCriteria = {
    tenant,
    interface         : DwnInterfaceName.Records,
    method            : DwnMethodName.Write,
    isLatestBaseState : 'true',
    ...exactCriteria
  };

  const rangeCriteria = RecordsQuery.getRangeCriteria(recordsQuery.message.descriptor.filter);
  const records = await messageStore.query(completeExactCriteria, rangeCriteria);
  return records;
}

/**
 * Fetches the records as a non-owner, return only:
 * 1. published records; and
 * 2. unpublished records intended for the requester (where `recipient` is the requester)
 */
async function fetchRecordsAsNonOwner(tenant: string, recordsQuery: RecordsQuery, messageStore: MessageStore)
  : Promise<BaseMessage[]> {
  const publishedRecords = await fetchPublishedRecords(tenant, recordsQuery, messageStore);
  const unpublishedRecordsForRequester = await fetchUnpublishedRecordsForRequester(tenant, recordsQuery, messageStore);
  const unpublishedRecordsByRequester = await fetchUnpublishedRecordsByRequester(tenant, recordsQuery, messageStore);
  const records = [...publishedRecords, ...unpublishedRecordsForRequester, ...unpublishedRecordsByRequester];
  return records;
}

/**
 * Fetches only published records.
 */
async function fetchPublishedRecords(tenant: string, recordsQuery: RecordsQuery, messageStore: MessageStore): Promise<BaseMessage[]> {
  // fetch all published records matching the query
  const exactCriteria = RecordsQuery.getExactCriteria(recordsQuery.message.descriptor.filter);
  const completeExactCriteria = {
    tenant,
    interface         : DwnInterfaceName.Records,
    method            : DwnMethodName.Write,
    published         : 'true',
    isLatestBaseState : 'true',
    ...exactCriteria
  };

  const rangeCriteria = RecordsQuery.getRangeCriteria(recordsQuery.message.descriptor.filter);
  const publishedRecords = await messageStore.query(completeExactCriteria, rangeCriteria);
  return publishedRecords;
}

/**
 * Fetches only unpublished records that are intended for the requester (where `recipient` is the requester).
 */
async function fetchUnpublishedRecordsForRequester(tenant: string, recordsQuery: RecordsQuery, messageStore: MessageStore)
  : Promise<BaseMessage[]> {
  // include records where recipient is requester
  const exactCriteria = RecordsQuery.getExactCriteria(recordsQuery.message.descriptor.filter);
  const completeExactCriteria = {
    tenant,
    interface         : DwnInterfaceName.Records,
    method            : DwnMethodName.Write,
    recipient         : recordsQuery.author,
    isLatestBaseState : 'true',
    published         : 'false',
    ...exactCriteria
  };

  const rangeCriteria = RecordsQuery.getRangeCriteria(recordsQuery.message.descriptor.filter);
  const unpublishedRecordsForRequester = await messageStore.query(completeExactCriteria, rangeCriteria);
  return unpublishedRecordsForRequester;
}

/**
 * Fetches only unpublished records that are authored by the requester.
 */
async function fetchUnpublishedRecordsByRequester(tenant: string, recordsQuery: RecordsQuery, messageStore: MessageStore)
  : Promise<BaseMessage[]> {
  // include records where recipient is requester
  const exactCriteria = RecordsQuery.getExactCriteria(recordsQuery.message.descriptor.filter);
  const completeExactCriteria = {
    tenant,
    author            : recordsQuery.author,
    interface         : DwnInterfaceName.Records,
    method            : DwnMethodName.Write,
    isLatestBaseState : 'true',
    published         : 'false',
    ...exactCriteria
  };

  const rangeCriteria = RecordsQuery.getRangeCriteria(recordsQuery.message.descriptor.filter);

  const unpublishedRecordsForRequester = await messageStore.query(completeExactCriteria, rangeCriteria);
  return unpublishedRecordsForRequester;
}

/**
 * Sorts the given records. There are 4 options for dateSort:
 * 1. createdAscending - Sort in ascending order based on when the message was created
 * 2. createdDescending - Sort in descending order based on when the message was created
 * 3. publishedAscending - If the message is published, sort in asc based on publish date
 * 4. publishedDescending - If the message is published, sort in desc based on publish date
 *
 * If sorting is based on date published, records that are not published are filtered out.
 * @param entries - Entries to be sorted if dateSort is present
 * @param dateSort - Sorting scheme
 * @returns Sorted Messages
 */
async function sortRecords(
  entries: BaseMessage[],
  dateSort: DateSort
): Promise<BaseMessage[]> {

  const messages = entries as RecordsWriteMessage[];

  switch (dateSort) {
  case DateSort.CreatedAscending:
    return messages.sort((a, b) => lexicographicalCompare(a.descriptor.dateCreated, b.descriptor.dateCreated));
  case DateSort.CreatedDescending:
    return messages.sort((a, b) => lexicographicalCompare(b.descriptor.dateCreated, a.descriptor.dateCreated));
  case DateSort.PublishedAscending:
    return messages
      .filter(m => m.descriptor.published)
      .sort((a, b) => lexicographicalCompare(a.descriptor.datePublished, b.descriptor.datePublished));
  case DateSort.PublishedDescending:
    return messages
      .filter(m => m.descriptor.published)
      .sort((a, b) => lexicographicalCompare(b.descriptor.datePublished, a.descriptor.datePublished));
  }
}
