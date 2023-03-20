import type { BaseMessage } from '../../core/types.js';
import type { DwnInterfaceName, DwnMethodName } from '../../index.js';

export type PermissionScope = {
  method: string
  schema?: string
  objectId?: string
};

export type PermissionConditions = {
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
  interface : DwnInterfaceName.Permissions
  method: DwnMethodName.Request
  dateCreated: string;
  conditions: PermissionConditions
  description: string
  grantedTo: string
  grantedBy: string
  objectId?: string
  scope: PermissionScope
};

export type PermissionsRequestMessage = BaseMessage & {
  descriptor: PermissionsRequestDescriptor;
};

export type PermissionsGrantDescriptor = {
  interface : DwnInterfaceName.Permissions
  method: DwnMethodName.Grant;
  dateCreated: string;
  conditions: PermissionConditions;
  delegatedFrom?: string;
  description: string;
  grantedTo: string;
  grantedBy: string;
  objectId: string;
  permissionsRequestId?: string;
  scope: PermissionScope;
};

export type PermissionsGrantMessage = BaseMessage & {
  descriptor: PermissionsGrantDescriptor;
  delegationChain?: PermissionsGrantMessage;
};