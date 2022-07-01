import type { Authorization, BaseMessageSchema } from '../../core/types';

export type Scope = {
  method: string
  schema?: string
  objectId?: string
};

export type Conditions = {
  // attestation indicates whether any inbound data should be signed.
  // defaults to `optional`
  attestation?: 'optional' | 'prohibited' | 'required'

  // delegation indicates that a given permission can be delegated to other entities.
  // defaults to `false`
  delegation?: boolean,

  // encryption indicates whether any inbound data should be encrypted.
  // defaults to 'optional'
  encryption?: 'optional' | 'required'

  // indicates whether a message written with the invocation of a permission can
  // be marked as public. public messages can be queried for without any authorization
  // defaults to false.
  publication?: boolean

  // sharedAccess indicates whether the requester has access to records authored
  // by others. False indicates that the requester only has access to records
  // they authored.
  // defaults to `false`
  sharedAccess?: boolean
};

export type PermissionsRequestDescriptor = {
  conditions: Conditions
  description: string
  grantedTo: string
  grantedBy: string
  method: 'PermissionsRequest'
  objectId?: string
  scope: Scope
};

export type PermissionsRequestSchema = BaseMessageSchema & Authorization & {
  descriptor: PermissionsRequestDescriptor;
};

export type PermissionsGrantDescriptor = {
  conditions: Conditions;
  delegatedFrom?: string;
  description: string;
  grantedTo: string;
  grantedBy: string;
  method: 'PermissionsGrant';
  objectId: string;
  permissionsRequestId?: string;
  scope: Scope;
};

export type PermissionsGrantSchema = BaseMessageSchema & Authorization & {
  descriptor: PermissionsGrantDescriptor;
  delegationChain?: PermissionsGrantSchema;
};