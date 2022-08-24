import type { Authorization } from '../../core/types';

export type CollectionsWriteDescriptor = {
  target: string;
  method: 'CollectionsWrite';
  protocol?: string;
  schema?: string;
  nonce: string;
  recordId: string;
  dataCid: string;
  dateCreated: number;
  published?: boolean;
  datePublished?: number;
  dataFormat: string;
};

export type CollectionsWriteSchema = Authorization & {
  descriptor: CollectionsWriteDescriptor;
  encodedData?: string;
};

export type CollectionsQueryDescriptor = {
  target: string;
  method: 'CollectionsQuery';
  nonce: string;
  filter: {
    protocol?: string;
    schema?: string;
    recordId?: string;
    dataFormat?: string;
  }
  dateSort?: string;
};

export type CollectionsQuerySchema = Authorization & {
  descriptor: CollectionsQueryDescriptor;
};