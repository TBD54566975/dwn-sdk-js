import type { Readable } from 'readable-stream';

export interface UploadStoreOptions {
  signal?: AbortSignal;
}

export interface UploadStore {
  open(): Promise<void>;

  close(): Promise<void>;

  start(tenant: string, recordId: string, dataFormat: string, options?: UploadStoreOptions): Promise<boolean>;

  part(tenant: string, recordId: string, index: number, dataStream: Readable, options?: UploadStoreOptions): Promise<UploadPartResult>;

  complete(tenant: string, recordId: string, count: number, options?: UploadStoreOptions): Promise<UploadCompleteResult>;

  has(tenant: string, recordId: string, options?: UploadStoreOptions): Promise<boolean>;

  get(tenant: string, recordId: string, options?: UploadStoreOptions): Promise<Readable | undefined>;

  delete(tenant: string, recordId: string, options?: UploadStoreOptions): Promise<void>;
}

export type UploadPartResult = {
  dataCid: string;
  dataSize: number;
};

export type UploadCompleteResult = {
  dataCid: string;
  dataSize: number;
};