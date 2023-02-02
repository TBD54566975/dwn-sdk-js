import { BaseMessage } from '../../core/types.js';
import { DateSort } from './messages/records-query.js';
import { GeneralJws } from '../../jose/jws/general/types.js';
import { DwnInterfaceName, DwnMethodName } from '../../core/message.js';

export type RecordsWriteDescriptor = {
  interface: DwnInterfaceName.Records;
  method: DwnMethodName.Write;
  protocol?: string;
  recipient: string;
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
  attestation?: GeneralJws;
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
  interface: DwnInterfaceName.Records;
  method: DwnMethodName.Query;
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

export type RecordsWriteAttestationPayload = {
  descriptorCid: string;
};

export type RecordsWriteAuthorizationPayload = {
  recordId: string;
  contextId?: string;
  descriptorCid: string;
  attestationCid?: string;
};

export type RecordsQueryMessage = BaseMessage & {
  descriptor: RecordsQueryDescriptor;
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