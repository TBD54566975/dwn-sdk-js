import type { GenericMessage } from './message-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../core/message.js';

export type SnapshotsCreateDescriptor = {
  interface : DwnInterfaceName.Snapshots;
  method: DwnMethodName.Create;
  messageTimestamp: string;
  definitionCid: string;
};

export type SnapshotDefinition = {
  scope: SnapshotScope;
  messageCids: string[];
};

export type SnapshotScope = SnapshotPermissionScope | SnapshotProtocolScope;

export enum SnapshotScopeType {
  Permissions = 'permissions',
  Protocols = 'protocols'
};

export type SnapshotPermissionScope = {
  type: SnapshotScopeType.Permissions,
  permissionsGrantId: string
};

export type SnapshotProtocolScope = {
  type: SnapshotScopeType.Protocols,
  protocolPath: string
};

export type SnapshotsCreateMessage = GenericMessage & {
  descriptor: SnapshotsCreateDescriptor;
};
