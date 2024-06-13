import type { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

/**
 * Type for the data payload of a permission request message.
 */
export type PermissionRequestData = {

  /**
   * If the grant is a delegated grant or not. If `true`, the `grantedTo` will be able to act as the `grantedBy` within the scope of this grant.
   */
  delegated: boolean;

  /**
   * Optional string that communicates what the grant would be used for.
   */
  description?: string;

  /**
   * The scope of the allowed access.
   */
  scope: PermissionScope;

  conditions?: PermissionConditions
};

/**
 * Type for the data payload of a permission grant message.
 */
export type PermissionGrantData = {
  /**
   * Optional string that communicates what the grant would be used for
   */
  description?: string;

  /**
   * Optional CID of a permission request. This is optional because grants may be given without being officially requested
   * */
  requestId?: string;

  /**
   * Timestamp at which this grant will no longer be active.
   */
  dateExpires: string;

  /**
   * Whether this grant is delegated or not. If `true`, the `grantedTo` will be able to act as the `grantedTo` within the scope of this grant.
   */
  delegated?: boolean;

  /**
   * The scope of the allowed access.
   */
  scope: PermissionScope;

  conditions?: PermissionConditions
};

/**
 * Type for the data payload of a permission revocation message.
 */
export type PermissionRevocationData = {
  /**
   * Optional string that communicates the details of the revocation.
   */
  description?: string;
};

/**
 * The data model for a permission scope.
 */
export type PermissionScope = ProtocolPermissionScope | MessagesPermissionScope | EventsPermissionScope | RecordsPermissionScope;

export type ProtocolPermissionScope = {
  interface: DwnInterfaceName.Protocols;
  method: DwnMethodName.Configure | DwnMethodName.Query;
};

export type MessagesPermissionScope = {
  interface: DwnInterfaceName.Messages;
  method: DwnMethodName.Get;
};

export type EventsPermissionScope = {
  interface: DwnInterfaceName.Events;
  method: DwnMethodName.Get | DwnMethodName.Query | DwnMethodName.Subscribe;
};

/**
 * The data model for a permission scope that is specific to the Records interface.
 */
export type RecordsPermissionScope = {
  interface: DwnInterfaceName.Records;
  method: DwnMethodName.Read | DwnMethodName.Write | DwnMethodName.Query | DwnMethodName.Subscribe | DwnMethodName.Delete;
  protocol: string;
  /** May only be present when `protocol` is defined and `protocolPath` is undefined */
  contextId?: string;
  /** May only be present when `protocol` is defined and `contextId` is undefined */
  protocolPath?: string;
};

export enum PermissionConditionPublication {
  Required = 'Required',
  Prohibited = 'Prohibited',
}

export type PermissionConditions = {
  /**
   * indicates whether a message written with the invocation of a permission must, may, or must not
   * be marked as public.
   * If `undefined`, it is optional to make the message public.
   */
  publication?: PermissionConditionPublication;
};