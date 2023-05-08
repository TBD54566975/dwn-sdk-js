import type { BaseMessage } from '../../core/types.js';
import type { DwnInterfaceName, DwnMethodName } from '../../core/message.js';

export type ProtocolsConfigureDescriptor = {
  interface : DwnInterfaceName.Protocols;
  method: DwnMethodName.Configure;
  dateCreated: string;
  protocol: string;
  types: ProtocolTypes;
  definition: ProtocolDefinition;
};

export type ProtocolDefinition = {
  [key: string]: ProtocolRuleSet;
};

export type ProtocolType = {
  schema?: string,
  dataFormats: string[],
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

export type ProtocolRuleSet = {
  $actions?: ProtocolActionRule[];
  // Need to allow (ProtocolActionRule[] | undefined) in order for typescript to allow $actions
  // In practice, everything except $actions should be a ProtocolRuleSet
  [key: string]: ProtocolRuleSet | (ProtocolActionRule[] | undefined);
};

export type ProtocolActionRule = {
  who: string,
  of?: string,
  can: string
};

export type ProtocolsConfigureMessage = BaseMessage & {
  descriptor: ProtocolsConfigureDescriptor;
};

export type ProtocolsQueryFilter = {
  protocol: string,
};

export type ProtocolsQueryDescriptor = {
  interface : DwnInterfaceName.Protocols,
  method: DwnMethodName.Query;
  dateCreated: string;
  filter?: ProtocolsQueryFilter
};

export type ProtocolsQueryMessage = BaseMessage & {
  descriptor: ProtocolsQueryDescriptor;
};
