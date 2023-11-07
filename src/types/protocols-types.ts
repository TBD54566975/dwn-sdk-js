import type { GenericMessageReply } from '../core/message-reply.js';
import type { PublicJwk } from './jose-types.js';
import type { AuthorizationModel, GenericMessage } from './message-types.js';
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
   * Denotes if this Protocol Definition can be returned by unauthenticated `ProtocolsQuery`.
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
  Delete = 'delete',
  Query = 'query',
  Read = 'read',
  Update = 'update',
  Write = 'write'
}

/**
 * Rules defining which actors may access a record at the given protocol path.
 * Rules take three forms:
 * 1. Anyone can write.
 *   {
 *     who: 'anyone',
 *     can: 'write
 *   }
 *
 * 2. Author of protocolPath can write; OR
 *    Recipient of protocolPath can write.
 *   {
 *     who: 'recipient'
 *     of: 'requestForQuote',
 *     can: 'write'
 *   }
 *
 * 3. Role can write.
 *   {
 *     role: 'friend',
 *     can: 'write'
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
   * The protocol path of a record marked with $globalRole: true.
   * Mutually exclusive with `who`
   */
  role?: string;

  /**
   * Protocol path.
   * Must be present if `who` === 'author' or 'recipient'
   */
  of?: string;

  /**
   * Action that the actor can perform.
   * May be 'query' | 'read' | 'write'
   * 'query' is only supported for `role` rules.
   */
  can: string;
};
/**
 * Config for protocol-path encryption scheme.
 */
export type ProtocolPathEncryption = {
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
   * If true, this marks a record as a `role` that may be used across contexts. Only root records
   * may set $globalRole: true.
   * The recipient of a $globalRole record may invoke their role in RecordsRead or RecordsWrites
   * by setting `protocolRole` property to the protocol path of the $globalRole record.
   */
  $globalRole?: boolean;
  /**
   * If true, this marks a record as a `role` that may used within a single context. Only
   * second-level records may set $contextRole: true.
   * The recipient of a $contextRole record may invoke their role in RecordsReads or RecordsWrites
   * by setting `protocolRole` property to the protocol path of the $contextRole record.
   */
  $contextRole?: boolean;
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
