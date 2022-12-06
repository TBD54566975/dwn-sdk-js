import type { CollectionsQueryMessage } from '../types';
import type { MethodHandler } from '../../types';

import { BaseMessage } from '../../../core/types';
import { CollectionsQuery } from '../messages/collections-query';
import { DwnMethodName } from '../../../core/message';
import { MessageReply } from '../../../core';
import { MessageStore } from '../../../store/message-store';
import { removeUndefinedProperties } from '../../../utils/object';

export const handleCollectionsQuery: MethodHandler = async (
  message,
  messageStore,
  didResolver
): Promise<MessageReply> => {
  const collectionsQuery = await CollectionsQuery.parse(message as CollectionsQueryMessage);

  try {
    await collectionsQuery.verifyAuth(didResolver, messageStore);
  } catch (e) {
    return new MessageReply({
      status: { code: 401, detail: e.message }
    });
  }

  try {
    if (collectionsQuery.message.descriptor.dateSort) {
      throw new Error('`dateSort` not implemented');
    }

    let entries: BaseMessage[];
    if (collectionsQuery.author === collectionsQuery.target) {
      entries = await fetchRecordsAsOwner(collectionsQuery, messageStore);
    } else {
      entries = await fetchRecordsAsNonOwner(collectionsQuery, messageStore);
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
    published         : true,
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
    published: true
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
    published: true
  };

  const unpublishedRecordsForRequester = await messageStore.query(includeCriteria, excludeCriteria);
  return unpublishedRecordsForRequester;
}