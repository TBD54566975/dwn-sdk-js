import { BaseMessage } from '../../core/types';
import { DwnMethodName } from '../../core/message';

export type CollectionsWriteDescriptor = {
  target: string;
  recipient: string;
  method: DwnMethodName.CollectionsWrite;
  protocol?: string;
  schema?: string;
  lineageParent?: string;
  parentId?: string;
  dataCid: string;
  dateCreated: string;
  published?: boolean;
  datePublished?: number;
  dataFormat: string;
};

export type CollectionsWriteMessage = BaseMessage & {
  recordId: string,
  contextId?: string;
  descriptor: CollectionsWriteDescriptor;
  encodedData?: string;
};

export type CollectionsQueryDescriptor = {
  target: string;
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
  dateSort?: string;
};

export type CollectionsWriteAuthorizationPayload = {
  recordId: string;
  contextId?: string;
  descriptorCid: string;
};

export type CollectionsQueryMessage = BaseMessage & {
  descriptor: CollectionsQueryDescriptor;
};