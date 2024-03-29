import type { AuthorizationModel, GenericMessage } from './message-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';
import type { PermissionConditions, PermissionScope } from './permission-types.js';

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
  authorization: AuthorizationModel; // overriding `GenericMessage` with `authorization` being required
  descriptor: PermissionsRequestDescriptor;
};
