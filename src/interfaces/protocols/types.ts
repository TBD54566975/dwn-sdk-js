import type { AuthorizableMessage } from '../../core/types';

export type ProtocolsConfigureDescriptor = {
  target: string;
  method: 'ProtocolsConfigure';
  dateCreated: number;
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

export type ProtocolsConfigureMessage = AuthorizableMessage & {
  descriptor: ProtocolsConfigureDescriptor;
};

export type ProtocolsQueryDescriptor = {
  target: string;
  method: 'ProtocolsQuery';
  dateCreated: number;
  filter?: {
    protocol: string;
  }
};

export type ProtocolsQueryMessage = AuthorizableMessage & {
  descriptor: ProtocolsQueryDescriptor;
};
