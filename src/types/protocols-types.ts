import type { PublicJwk } from './jose-types.js';
import type { AuthorizationModel, GenericMessage, GenericMessageReply } from './message-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export type ProtocolsConfigureDescriptor = {
  interface : DwnInterfaceName.Protocols;
  method: DwnMethodName.Configure;
  messageTimestamp: string;
  definition: ProtocolDefinition;
};

export type ProtocolDefinition = {
  protocol: string;
  /**
   * Denotes if this Protocol Definition can be returned by unauthenticated or unauthorized `ProtocolsQuery`.
   */
  published: boolean;
  types: ProtocolTypes;
  structure: {
    [key: string]: ProtocolRuleSet;
  }
};

export type ProtocolType = {
  schema?: string,
  dataFormats?: string[],
};

export type ProtocolTypes = {
  [key: string]: ProtocolType;
};

export enum ProtocolActor {
  Anyone = 'anyone',
  Author = 'author',
  Recipient = 'recipient'
}

export enum ProtocolAction {
  CoDelete = 'co-delete',
  CoPrune = 'co-prune',
  CoUpdate = 'co-update',
  Create = 'create',
  Delete = 'delete',
  Prune = 'prune',
  Query = 'query',
  Read = 'read',
  Subscribe = 'subscribe',
  Update = 'update'
}

/**
 * Rules defining which actors may access a record at the given protocol path.
 * Rules take three forms, e.g.:
 * 1. Anyone can create.
 *   {
 *     who: 'anyone',
 *     can: ['create']
 *   }
 *
 * 2. Author of protocolPath can create; OR
 *    Recipient of protocolPath can write.
 *   {
 *     who: 'recipient'
 *     of: 'requestForQuote',
 *     can: ['create']
 *   }
 *
 * 3. Role can create.
 *   {
 *     role: 'friend',
 *     can: ['create']
 *   }
 */
export type ProtocolActionRule = {
  /**
   * May be 'anyone' | 'author' | 'recipient'.
   * If `who` === 'anyone', then `of` must be omitted. Otherwise `of` must be present.
   * Mutually exclusive with `role`
   */
  who?: string,

  /**
   * The protocol path of a role record type marked with $role: true.
   * Mutually exclusive with `who`
   */
  role?: string;

  /**
   * Protocol path.
   * Must be present if `who` === 'author' or 'recipient'
   */
  of?: string;

  /**
   * Array of actions that the actor/role can perform.
   * See {ProtocolAction} for possible values.
   * 'query' and 'subscribe' are only supported for `role` rules.
   */
  can: string[];
};
/**
 * Config for protocol-path encryption scheme.
 */
export type ProtocolPathEncryption = {

  /**
   * The ID of the root key that derives the public key at this protocol path for encrypting the symmetric key used for data encryption.
   */
  rootKeyId: string;

  /**
   * Public key for encrypting the symmetric key used for data encryption.
   */
  publicKeyJwk: PublicJwk;
};

export type ProtocolRuleSet = {
  /**
   * Encryption setting for objects that are in this protocol path.
   */
  $encryption?: ProtocolPathEncryption;
  $actions?: ProtocolActionRule[];

  /**
   * If true, this marks a record as a `role` that may used within a context.
   * The recipient of a $role record may invoke their role by setting `protocolRole` property to the protocol path of the $role record.
   */
  $role?: boolean;

  /**
   * If $size is set, the record size in bytes must be within the limits.
   */
  $size?: {
    min?: number,
    max?: number
  }

  /**
   * If $tags is set, the record must conform to the tag rules.
   */
  $tags?: {
    /** array of required tags */
    $requiredTags?: string[],
    /** allow properties other than those explicitly listed. defaults to false  */
    $allowUndefinedTags?: boolean;

    [key: string]: any;
  }

  // JSON Schema verifies that properties other than properties prefixed with $ will actually have type ProtocolRuleSet
  [key: string]: any;
};

export type ProtocolsConfigureMessage = GenericMessage & {
  authorization: AuthorizationModel; // overriding `GenericMessage` with `authorization` being required
  descriptor: ProtocolsConfigureDescriptor;
};

export type ProtocolsQueryFilter = {
  protocol: string,
};

export type ProtocolsQueryDescriptor = {
  interface : DwnInterfaceName.Protocols,
  method: DwnMethodName.Query;
  messageTimestamp: string;
  filter?: ProtocolsQueryFilter
};

export type ProtocolsQueryMessage = GenericMessage & {
  descriptor: ProtocolsQueryDescriptor;
};

export type ProtocolsQueryReply = GenericMessageReply & {
  entries?: ProtocolsConfigureMessage[];
};
