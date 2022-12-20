import type { MethodHandler } from '../../types.js';
import type { CollectionsQueryMessage, CollectionsWriteMessage } from '../types.js';

import { authenticate } from '../../../core/auth.js';
import { BaseMessage } from '../../../core/types.js';
import { DwnMethodName } from '../../../core/message.js';
import { MessageReply } from '../../../core/message-reply.js';
import { MessageStore } from '../../../store/message-store.js';
import { removeUndefinedProperties } from '../../../utils/object.js';
import { CollectionsQuery, DateSortName } from '../messages/collections-query.js';

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

  try {
    let entries: BaseMessage[];
    if (collectionsQuery.author === collectionsQuery.target) {
      entries = await fetchRecordsAsOwner(collectionsQuery, messageStore);
    } else {
      entries = await fetchRecordsAsNonOwner(collectionsQuery, messageStore);
    }

    if (collectionsQuery.message.descriptor.dateSort) {
      entries = await handleDateSort(collectionsQuery, entries);
    }

    return new MessageReply({
      status: { code: 200, detail: 'OK' },
      entries
    });
  } catch (e) {
    return new MessageReply({
      status: { code: 500, detail: e.message }
    });
  }
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
    ...collectionsQuery.message.descriptor.filter
  };
  removeUndefinedProperties(includeCriteria);

  // exclude all published records
  const excludeCriteria = {
    published: 'true'
  };

  const unpublishedRecordsForRequester = await messageStore.query(includeCriteria, excludeCriteria);
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
    ...collectionsQuery.message.descriptor.filter
  };
  removeUndefinedProperties(includeCriteria);

  // exclude all published records
  const excludeCriteria = {
    published: 'true'
  };

  const unpublishedRecordsForRequester = await messageStore.query(includeCriteria, excludeCriteria);
  return unpublishedRecordsForRequester;
}

/**
 * Handles dateSort field passed in the CollectionsQuery. There are 4 options for dateSort:
 * 1. createdAscending - Sort in ascending order based on when the message was created
 * 2. createdDescending - Sort in descending order based on when the message was created
 * 3. publishedAscending - If the message is published, sort in asc based on publish date
 * 4. publishedDescending - If the message is published, sort in desc based on publish date
 *
 * If dateSort is not present we return the unmodified list of entries. This method throws
 * if there is an unsupported DateSort operation.
 *
 * @param collectionsQuery - Underlying Collections Query
 * @param entries - Entries to be sorted if dateSort is present
 * @returns List of Messages
 */
async function handleDateSort(
  collectionsQuery: CollectionsQuery,
  entries: BaseMessage[]
): Promise<BaseMessage[]> {

  const { dateSort } = collectionsQuery.message.descriptor;
  const collectionMessages = entries as CollectionsWriteMessage[];

  switch (dateSort) {
  case DateSortName.CreatedAscending:
    return collectionMessages.sort(getCompareByPropertyFn('dateCreated', 'asc'));
  case DateSortName.CreatedDescending:
    return collectionMessages.sort(getCompareByPropertyFn('dateCreated', 'desc'));
  case DateSortName.PublishedAscending:
    return collectionMessages
      .filter(m => m.descriptor.published)
      .sort(getCompareByPropertyFn('datePublished', 'asc'));
  case DateSortName.PublishedDescending:
    return collectionMessages
      .filter(m => m.descriptor.published)
      .sort(getCompareByPropertyFn('datePublished', 'desc'));
  default:
    throw new Error(`Invalid DateSort String: ${dateSort}`);
  }
}

function getCompareByPropertyFn(
  property: string,
  direction: 'asc' | 'desc'
): (left: CollectionsWriteMessage, right: CollectionsWriteMessage) => number {

  if (direction === 'asc') {
    return (left, right): number => {
      return left.descriptor[property] - right.descriptor[property];
    };
  }

  return (left, right): number => {
    return right.descriptor[property] - left.descriptor[property];
  };
}