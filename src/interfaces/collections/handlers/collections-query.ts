import type { MethodHandler } from '../../types.js';
import type { CollectionsQueryMessage, CollectionsWriteMessage } from '../types.js';

import { authenticate } from '../../../core/auth.js';
import { BaseMessage } from '../../../core/types.js';
import { DwnMethodName } from '../../../core/message.js';
import { lexicographicalCompare } from '../../../utils/string.js';
import { MessageReply } from '../../../core/message-reply.js';
import { MessageStore } from '../../../store/message-store.js';
import { removeUndefinedProperties } from '../../../utils/object.js';
import { CollectionsQuery, DateSort } from '../messages/collections-query.js';

export const handleCollectionsQuery: MethodHandler = async (
  message,
  messageStore,
  didResolver
): Promise<MessageReply> => {
  let collectionsQuery: CollectionsQuery;
  try {
    collectionsQuery = await CollectionsQuery.parse(message as CollectionsQueryMessage);
  } catch (e) {
    return new MessageReply({
      status: { code: 400, detail: e.message }
    });
  }

  try {
    await authenticate(message.authorization, didResolver);
    await collectionsQuery.authorize();
  } catch (e) {
    return new MessageReply({
      status: { code: 401, detail: e.message }
    });
  }

  let records: BaseMessage[];
  if (collectionsQuery.author === collectionsQuery.target) {
    records = await fetchRecordsAsOwner(collectionsQuery, messageStore);
  } else {
    records = await fetchRecordsAsNonOwner(collectionsQuery, messageStore);
  }

  // sort if `dataSort` is specified
  if (collectionsQuery.message.descriptor.dateSort) {
    records = await sortRecords(records, collectionsQuery.message.descriptor.dateSort);
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
async function fetchRecordsAsOwner(collectionsQuery: CollectionsQuery, messageStore: MessageStore): Promise<BaseMessage[]> {
  // fetch all published records matching the query
  const includeCriteria = {
    target            : collectionsQuery.target,
    method            : DwnMethodName.CollectionsWrite,
    isLatestBaseState : 'true',
    ...collectionsQuery.message.descriptor.filter
  };
  removeUndefinedProperties(includeCriteria);

  const records = await messageStore.query(includeCriteria);
  return records;
}

/**
 * Fetches the records as a non-owner, return only:
 * 1. published records; and
 * 2. unpublished records intended for the requester (where `recipient` is the requester)
 */
async function fetchRecordsAsNonOwner(collectionsQuery: CollectionsQuery, messageStore: MessageStore)
  : Promise<BaseMessage[]> {
  const publishedRecords = await fetchPublishedRecords(collectionsQuery, messageStore);
  const unpublishedRecordsForRequester = await fetchUnpublishedRecordsForRequester(collectionsQuery, messageStore);
  const unpublishedRecordsByRequester = await fetchUnpublishedRecordsByRequester(collectionsQuery, messageStore);
  const records = [...publishedRecords, ...unpublishedRecordsForRequester, ...unpublishedRecordsByRequester];
  return records;
}

/**
 * Fetches only published records.
 */
async function fetchPublishedRecords(collectionsQuery: CollectionsQuery, messageStore: MessageStore): Promise<BaseMessage[]> {
  // fetch all published records matching the query
  const includeCriteria = {
    target            : collectionsQuery.target,
    method            : DwnMethodName.CollectionsWrite,
    published         : 'true',
    isLatestBaseState : 'true',
    ...collectionsQuery.message.descriptor.filter
  };
  removeUndefinedProperties(includeCriteria);

  const publishedRecords = await messageStore.query(includeCriteria);
  return publishedRecords;
}

/**
 * Fetches only unpublished records that are intended for the requester (where `recipient` is the requester).
 */
async function fetchUnpublishedRecordsForRequester(collectionsQuery: CollectionsQuery, messageStore: MessageStore)
  : Promise<BaseMessage[]> {
  // include records where recipient is requester
  const includeCriteria = {
    target            : collectionsQuery.target,
    recipient         : collectionsQuery.author,
    method            : DwnMethodName.CollectionsWrite,
    isLatestBaseState : 'true',
    published         : 'false',
    ...collectionsQuery.message.descriptor.filter
  };
  removeUndefinedProperties(includeCriteria);

  const unpublishedRecordsForRequester = await messageStore.query(includeCriteria);
  return unpublishedRecordsForRequester;
}

/**
 * Fetches only unpublished records that are authored by the requester.
 */
async function fetchUnpublishedRecordsByRequester(collectionsQuery: CollectionsQuery, messageStore: MessageStore)
 : Promise<BaseMessage[]> {
  // include records where recipient is requester
  const includeCriteria = {
    target            : collectionsQuery.target,
    author            : collectionsQuery.author,
    method            : DwnMethodName.CollectionsWrite,
    isLatestBaseState : 'true',
    published         : 'false',
    ...collectionsQuery.message.descriptor.filter
  };
  removeUndefinedProperties(includeCriteria);

  const unpublishedRecordsForRequester = await messageStore.query(includeCriteria);
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

  const collectionMessages = entries as CollectionsWriteMessage[];

  switch (dateSort) {
  case DateSort.CreatedAscending:
    return collectionMessages.sort((a, b) => lexicographicalCompare(a.descriptor.dateCreated, b.descriptor.dateCreated));
  case DateSort.CreatedDescending:
    return collectionMessages.sort((a, b) => lexicographicalCompare(b.descriptor.dateCreated, a.descriptor.dateCreated));
  case DateSort.PublishedAscending:
    return collectionMessages
      .filter(m => m.descriptor.published)
      .sort((a, b) => lexicographicalCompare(a.descriptor.datePublished, b.descriptor.datePublished));
  case DateSort.PublishedDescending:
    return collectionMessages
      .filter(m => m.descriptor.published)
      .sort((a, b) => lexicographicalCompare(b.descriptor.datePublished, a.descriptor.datePublished));
  }
}
