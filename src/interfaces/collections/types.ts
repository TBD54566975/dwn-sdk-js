import type { AuthorizableMessage } from '../../core/types';

export type CollectionsWriteDescriptor = {
  target: string;
  recipient: string;
  method: 'CollectionsWrite';
  protocol?: string;
  contextId?: string;
  schema?: string;
  recordId: string;
  parentId?: string;
  dataCid: string;
  dateCreated: number;
  published?: boolean;
  datePublished?: number;
  dataFormat: string;
};

export type CollectionsWriteMessage = AuthorizableMessage & {
  descriptor: CollectionsWriteDescriptor;
  encodedData?: string;
};

export type CollectionsQueryDescriptor = {
  target: string;
  method: 'CollectionsQuery';
  dateCreated: number;
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

export type CollectionsQueryMessage = AuthorizableMessage & {
  descriptor: CollectionsQueryDescriptor;
};