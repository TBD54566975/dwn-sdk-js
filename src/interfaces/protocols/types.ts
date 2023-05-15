import type { BaseMessage } from '../../core/types.js';
import type { DwnInterfaceName, DwnMethodName } from '../../core/message.js';

export type ProtocolsConfigureDescriptor = {
  interface : DwnInterfaceName.Protocols;
  method: DwnMethodName.Configure;
  dateCreated: string;
  definition: ProtocolDefinition;
};

export type ProtocolDefinition = {
  protocol: string;
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

export type ProtocolRuleSet = {
  $actions?: ProtocolActionRule[];
  // JSON Schema verifies that properties other than `$actions` will actually have type ProtocolRuleSet
  [key: string]: any;
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
