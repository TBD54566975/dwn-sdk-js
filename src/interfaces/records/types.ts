import { BaseMessage } from '../../core/types.js';
import { DateSort } from './messages/records-query.js';
import { DwnMethodName } from '../../core/message.js';

export type RecordsWriteDescriptor = {
  recipient: string;
  method: DwnMethodName.RecordsWrite;
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

export type RecordsWriteMessage = BaseMessage & {
  recordId: string,
  contextId?: string;
  descriptor: RecordsWriteDescriptor;
  encodedData?: string;
};

/**
 * Used by the entries returned by queries.
 */
export type UnsignedRecordsWriteMessage = {
  recordId: string,
  contextId?: string;
  descriptor: RecordsWriteDescriptor;
  encodedData?: string;
};

export type RecordsQueryDescriptor = {
  method: DwnMethodName.RecordsQuery;
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

export type RecordsWriteAuthorizationPayload = {
  target: string;
  recordId: string;
  contextId?: string;
  descriptorCid: string;
};

export type RecordsQueryMessage = BaseMessage & {
  descriptor: RecordsQueryDescriptor;
};