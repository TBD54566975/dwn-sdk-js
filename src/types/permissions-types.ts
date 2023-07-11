import type { GenericMessage } from './message-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../index.js';

export type PermissionScope = {
  interface: DwnInterfaceName;
  method: DwnMethodName;
};

export type PermissionConditions = {
  // indicates whether a message written with the invocation of a permission can
  // be marked as public. public messages can be queried for without any authorization
  // defaults to false.
  publication?: boolean;
};

export type PermissionsRequestDescriptor = {
  interface: DwnInterfaceName.Permissions;
  method: DwnMethodName.Request;
  messageTimestamp: string;
  // The DID of the DWN which the grantee will be given access
  grantedFor: string;
  // The recipient of the grant. Usually this is the author of the PermissionsRequest message
  grantedTo: string;
  // The granter, who will be either the DWN owner or an entity who the DWN owner has delegated permission to.
  grantedBy: string;
  // Optional string that communicates what the grant would be used for
  description?: string;
  scope: PermissionScope;
  conditions?: PermissionConditions;
};

export type PermissionsRequestMessage = GenericMessage & {
  descriptor: PermissionsRequestDescriptor;
};

export type PermissionsGrantDescriptor = {
  interface: DwnInterfaceName.Permissions;
  method: DwnMethodName.Grant;
  messageTimestamp: string;
  // Optional CID of a PermissionsRequest message. This is optional because grants may be given without being officially requested
  permissionsRequestId?: string;
  // Optional timestamp at which this grant will no longer be active.
  dateExpires: string;
  // The DID of the DWN which the grantee will be given access
  grantedFor: string;
  // The recipient of the grant. Usually this is the author of the PermissionsRequest message
  grantedTo: string;
  // The granter, who will be either the DWN owner or an entity who the DWN owner has delegated permission to.
  grantedBy: string;
  // Optional string that communicates what the grant would be used for
  description?: string;
  scope: PermissionScope;
  conditions?: PermissionConditions
};

export type PermissionsGrantMessage = GenericMessage & {
  descriptor: PermissionsGrantDescriptor;
};

export type PermissionsRevokeDescriptor = {
  interface: DwnInterfaceName.Permissions;
  method: DwnMethodName.Revoke;
  messageTimestamp: string;
  // The CID of the `PermissionsGrant` message being revoked.
  permissionsGrantId: string;
};

export type PermissionsRevokeMessage = GenericMessage & {
  descriptor: PermissionsRevokeDescriptor;
};