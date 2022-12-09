import type { BaseMessage } from '../../core/types.js';
import { DwnMethodName } from '../../core/message.js';

export type ProtocolsConfigureDescriptor = {
  method: DwnMethodName.ProtocolsConfigure;
  dateCreated: string;
  protocol: string;
  definition: ProtocolDefinition;
};

export type ProtocolDefinition = {
  labels: {
    [key: string]: { schema: string };
  };
  records: {
    [key: string]: ProtocolRuleSet;
  };
};

export type ProtocolRuleSet = {
  allow?: {
    anyone?: {
      to: string[];
    };
    recipient?: {
      of: string,
      to: string[];
    }
  };
  records?: {
    [key: string]: ProtocolRuleSet;
  }
};

export type ProtocolsConfigureMessage = BaseMessage & {
  descriptor: ProtocolsConfigureDescriptor;
};

export type ProtocolsQueryDescriptor = {
  method: DwnMethodName.ProtocolsQuery;
  dateCreated: string;
  filter?: {
    protocol: string;
  }
};

export type ProtocolsQueryMessage = BaseMessage & {
  descriptor: ProtocolsQueryDescriptor;
};
