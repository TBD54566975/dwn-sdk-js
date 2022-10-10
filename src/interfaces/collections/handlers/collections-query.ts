import type { MethodHandler } from '../../types';
import type { CollectionsQueryMessage } from '../types';
import { BaseMessage } from '../../../core/types';
import { CollectionsQuery } from '../messages/collections-query';
import { MessageReply } from '../../../core';
import { MessageStore } from '../../../store/message-store';
import { removeUndefinedProperties } from '../../../utils/object';

export const handleCollectionsQuery: MethodHandler = async (
  message,
  messageStore,
  didResolver
): Promise<MessageReply> => {
  const collectionsQueryMessage = new CollectionsQuery(message as CollectionsQueryMessage);

  let requesterDid: string;
  try {
    const authResult = await collectionsQueryMessage.verifyAuth(didResolver, messageStore);
    requesterDid = authResult.author;
  } catch (e) {
    return new MessageReply({
      status: { code: 401, detail: e.message }
    });
  }

  try {
    const validatedMessage = message as CollectionsQueryMessage;

    if (validatedMessage.descriptor.dateSort) {
      throw new Error('`dateSort` not implemented');
    }

    let entries: BaseMessage[];
    if (requesterDid === validatedMessage.descriptor.target) {
      entries = await fetchRecordsAsOwner(validatedMessage, messageStore);
    } else {
      entries = await fetchRecordsAsNonOwner(validatedMessage, messageStore, requesterDid);
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
async function fetchRecordsAsOwner(queryMessage: CollectionsQueryMessage, messageStore: MessageStore): Promise<BaseMessage[]> {
  // fetch all published records matching the query
  const includeCriteria = {
    target : queryMessage.descriptor.target,
    method : 'CollectionsWrite',
    ...queryMessage.descriptor.filter
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
async function fetchRecordsAsNonOwner(queryMessage: CollectionsQueryMessage, messageStore: MessageStore, requesterDid: string)
  : Promise<BaseMessage[]> {
  const publishedRecords = await fetchPublishedRecords(queryMessage, messageStore);
  const unpublishedRecordsForRequester = await fetchUnpublishedRecordsForRequester(queryMessage, messageStore, requesterDid);
  const unpublishedRecordsByRequester = await fetchUnpublishedRecordsByRequester(queryMessage, messageStore, requesterDid);
  const records = [...publishedRecords, ...unpublishedRecordsForRequester, ...unpublishedRecordsByRequester];
  return records;
}

/**
 * Fetches only published records.
 */
async function fetchPublishedRecords(queryMessage: CollectionsQueryMessage, messageStore: MessageStore): Promise<BaseMessage[]> {
  // fetch all published records matching the query
  const includeCriteria = {
    target    : queryMessage.descriptor.target,
    method    : 'CollectionsWrite',
    published : true,
    ...queryMessage.descriptor.filter
  };
  removeUndefinedProperties(includeCriteria);

  const publishedRecords = await messageStore.query(includeCriteria);
  return publishedRecords;
}

/**
 * Fetches only unpublished records that are intended for the requester (where `recipient` is the requester).
 */
async function fetchUnpublishedRecordsForRequester(queryMessage: CollectionsQueryMessage, messageStore: MessageStore, requesterDid: string)
  : Promise<BaseMessage[]> {
  // include records where recipient is requester
  const includeCriteria = {
    target    : queryMessage.descriptor.target,
    recipient : requesterDid,
    method    : 'CollectionsWrite',
    ...queryMessage.descriptor.filter
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
async function fetchUnpublishedRecordsByRequester(queryMessage: CollectionsQueryMessage, messageStore: MessageStore, requesterDid: string)
 : Promise<BaseMessage[]> {
  // include records where recipient is requester
  const includeCriteria = {
    target : queryMessage.descriptor.target,
    author : requesterDid,
    method : 'CollectionsWrite',
    ...queryMessage.descriptor.filter
  };
  removeUndefinedProperties(includeCriteria);

  // exclude all published records
  const excludeCriteria = {
    published: true
  };

  const unpublishedRecordsForRequester = await messageStore.query(includeCriteria, excludeCriteria);
  return unpublishedRecordsForRequester;
}