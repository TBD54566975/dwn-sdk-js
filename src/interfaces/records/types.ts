import type { BaseMessage } from '../../core/types.js';
import type { DateSort } from './messages/records-query.js';
import type { GeneralJws } from '../../jose/jws/general/types.js';
import type { DwnInterfaceName, DwnMethodName, DwnStateName } from '../../core/message.js';

export type RecordsWriteDescriptor = {
  interface: DwnInterfaceName.Records;
  method: DwnMethodName.Write;
  protocol?: string;
  recipient: string;
  schema?: string;
  parentId?: string;
  dataCid: string;
  dataSize: number;
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
  attestation?: GeneralJws;
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

export type RecordsUploadDescriptor = {
  interface: DwnInterfaceName.Records;
  method: DwnMethodName.Upload;
  state: string;
  protocol?: string;
  schema?: string;
  recipient?: string;
};

export type RecordsUploadStartDescriptor = RecordsUploadDescriptor & {
  state: DwnStateName.Start;
  dataFormat: string;
};

export type RecordsUploadPartDescriptor = RecordsUploadDescriptor & {
  state: DwnStateName.Part;
  index: number;
  dataCid: string;
  dataSize: number;
};

export type RecordsUploadCompleteDescriptor = RecordsUploadDescriptor & {
  state: DwnStateName.Complete;
  count: number;
  dataCid: string;
  dataSize: number;
};

export type RecordsUploadMessage = BaseMessage & {
  recordId: string;
  descriptor: RecordsUploadDescriptor;
  attestation?: GeneralJws;
};

export type RecordsUploadStartMessage = RecordsUploadMessage & {
  descriptor: RecordsUploadStartDescriptor;
};

export type RecordsUploadPartMessage = RecordsUploadMessage & {
  descriptor: RecordsUploadPartDescriptor;
};

export type RecordsUploadCompleteMessage = RecordsUploadMessage & {
  descriptor: RecordsUploadCompleteDescriptor;
};

export type RecordsQueryDescriptor = {
  interface: DwnInterfaceName.Records;
  method: DwnMethodName.Query;
  dateCreated: string;
  filter: RecordsQueryFilter;
  dateSort?: DateSort;
};

export type RecordsQueryFilter = {
  state?: string;
  attester?: string;
  recipient?: string;
  protocol?: string;
  contextId?: string;
  schema?: string;
  recordId?: string;
  parentId?: string;
  dataFormat?: string;
  dateCreated?: RangeCriterion;
};

export type RangeCriterion = {
  /**
   * Inclusive starting date-time.
   */
  from?: string;

  /**
   * Inclusive end date-time.
   */
  to?: string;
};

export type RecordsAttestationPayload = {
  descriptorCid: string;
};

export type RecordsAuthorizationPayload = {
  recordId: string;
  contextId?: string;
  descriptorCid: string;
  attestationCid?: string;
};

export type RecordsQueryMessage = BaseMessage & {
  descriptor: RecordsQueryDescriptor;
};

export type RecordsReadMessage = {
  authorization?: GeneralJws;
  descriptor: RecordsReadDescriptor;
};

export type RecordsReadDescriptor = {
  interface: DwnInterfaceName.Records;
  method: DwnMethodName.Read;
  recordId: string;
  date: string;
};

export type RecordsDeleteMessage = BaseMessage & {
  descriptor: RecordsDeleteDescriptor;
};

export type RecordsDeleteDescriptor = {
  interface: DwnInterfaceName.Records;
  method: DwnMethodName.Delete;
  recordId: string;
  dateModified: string;
};