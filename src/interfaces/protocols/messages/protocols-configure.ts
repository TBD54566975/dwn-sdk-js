import type { AuthCreateOptions } from '../../../core/types';
import type { ProtocolDefinition, ProtocolsConfigureDescriptor, ProtocolsConfigureMessage } from '../types';
import { Message } from '../../../core';

export type ProtocolsConfigureOptions = AuthCreateOptions & {
  target: string;
  dateCreated? : number;
  protocol: string;
  definition : ProtocolDefinition;
};

export class ProtocolsConfigure extends Message {
  readonly message: ProtocolsConfigureMessage; // a more specific type than the base type defined in parent class

  constructor(message: ProtocolsConfigureMessage) {
    super(message);
  }

  static async create(options: ProtocolsConfigureOptions): Promise<ProtocolsConfigure> {
    const descriptor: ProtocolsConfigureDescriptor = {
      target      : options.target,
      method      : 'ProtocolsConfigure',
      dateCreated : options.dateCreated ?? Date.now(),
      protocol    : options.protocol,
      definition  : options.definition
    };

    Message.validateJsonSchema({ descriptor, authorization: { } });

    const authorization = await Message.signAsAuthorization(descriptor, options.signatureInput);
    const message = { descriptor, authorization };

    const protocolsConfigure = new ProtocolsConfigure(message);
    return protocolsConfigure;
  }
}
