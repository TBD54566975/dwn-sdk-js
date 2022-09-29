import type { AuthorizableMessage } from '../../core/types';

export type ProtocolsConfigureDescriptor = {
  target: string;
  method: 'ProtocolsConfigure';
  nonce: string;
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
      to: [string];
    };
    recipient?: {
      of: string,
      to: [string];
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
  nonce: string;
  filter?: {
    protocol: string;
  }
};

export type ProtocolsQueryMessage = AuthorizableMessage & {
  descriptor: ProtocolsQueryDescriptor;
};
