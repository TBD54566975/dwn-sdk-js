import type { GenericMessageReply } from '../core/message-reply.js';
import type { PublicJwk } from './jose-types.js';
import type { DwnInterfaceName, DwnMethodName } from '../core/message.js';
import type { GenericMessage, QueryResultEntry } from './message-types.js';

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
  Read = 'read',
  Write = 'write'
}

export type ProtocolActionRule = {
  who: string,
  of?: string,
  can: string
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
  // JSON Schema verifies that properties other than `$actions` will actually have type ProtocolRuleSet
  [key: string]: any;
};

export type ProtocolsConfigureMessage = GenericMessage & {
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
  entries?: QueryResultEntry[];
};
