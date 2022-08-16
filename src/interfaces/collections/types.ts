import type { Authorization, BaseMessageSchema } from '../../core/types';

export type CollectionsWriteDescriptor = {
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

export type CollectionsWriteSchema = BaseMessageSchema & Authorization & {
  descriptor: CollectionsWriteDescriptor;
  encodedData?: string;
};

export type CollectionsQueryDescriptor = {
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

export type CollectionsQuerySchema = BaseMessageSchema & Authorization & {
  descriptor: CollectionsQueryDescriptor;
};