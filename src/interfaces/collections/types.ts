import { BaseMessage } from '../../core/types.js';
import { DateSort } from './messages/collections-query.js';
import { DwnMethodName } from '../../core/message.js';

export type CollectionsWriteDescriptor = {
  recipient: string;
  method: DwnMethodName.CollectionsWrite;
  protocol?: string;
  schema?: string;
  parentId?: string;
  dataCid: string;
  dateCreated: string;
  dateModified: string;
  published?: boolean;
  datePublished?: string;
  dataFormat: string;
};

export type CollectionsWriteMessage = BaseMessage & {
  recordId: string,
  contextId?: string;
  descriptor: CollectionsWriteDescriptor;
  encodedData?: string;
};

/**
 * Used by the entries returned by queries.
 */
export type UnsignedCollectionsWriteMessage = {
  recordId: string,
  contextId?: string;
  descriptor: CollectionsWriteDescriptor;
  encodedData?: string;
};

export type CollectionsQueryDescriptor = {
  method: DwnMethodName.CollectionsQuery;
  dateCreated: string;
  filter: {
    recipient?: string;
    protocol?: string;
    contextId?: string;
    schema?: string;
    recordId?: string;
    parentId?: string;
    dataFormat?: string;
  }
  dateSort?: DateSort;
};

export type CollectionsWriteAuthorizationPayload = {
  target: string;
  recordId: string;
  contextId?: string;
  descriptorCid: string;
};

export type CollectionsQueryMessage = BaseMessage & {
  descriptor: CollectionsQueryDescriptor;
};