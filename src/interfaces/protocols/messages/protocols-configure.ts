import type { AuthCreateOptions } from '../../../core/types';
import type { ProtocolDefinition, ProtocolsConfigureDescriptor, ProtocolsConfigureMessage } from '../types';

import { DwnMethodName } from '../../../core/message';
import { getCurrentDateInHighPrecision } from '../../../utils/time';
import { Message } from '../../../core';

export type ProtocolsConfigureOptions = AuthCreateOptions & {
  target: string;
  dateCreated? : string;
  protocol: string;
  definition : ProtocolDefinition;
};

export class ProtocolsConfigure extends Message {
  readonly message: ProtocolsConfigureMessage; // a more specific type than the base type defined in parent class

  private constructor(message: ProtocolsConfigureMessage) {
    super(message);
  }

  public static async parse(message: ProtocolsConfigureMessage): Promise<ProtocolsConfigure> {
    return new ProtocolsConfigure(message);
  }

  public static async create(options: ProtocolsConfigureOptions): Promise<ProtocolsConfigure> {
    const descriptor: ProtocolsConfigureDescriptor = {
      method      : DwnMethodName.ProtocolsConfigure,
      dateCreated : options.dateCreated ?? getCurrentDateInHighPrecision(),
      protocol    : options.protocol,
      definition  : options.definition
    };

    Message.validateJsonSchema({ descriptor, authorization: { } });

    const authorization = await Message.signAsAuthorization(options.target, descriptor, options.signatureInput);
    const message = { descriptor, authorization };

    const protocolsConfigure = new ProtocolsConfigure(message);
    return protocolsConfigure;
  }
}
