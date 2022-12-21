import type { AuthCreateOptions } from '../../../core/types.js';
import type { ProtocolDefinition, ProtocolsConfigureDescriptor, ProtocolsConfigureMessage } from '../types.js';

import { getCurrentTimeInHighPrecision } from '../../../utils/time.js';
import { validateAuthorizationIntegrity } from '../../../core/auth.js';

import { DwnMethodName, Message } from '../../../core/message.js';

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
    await validateAuthorizationIntegrity(message);

    return new ProtocolsConfigure(message);
  }

  public static async create(options: ProtocolsConfigureOptions): Promise<ProtocolsConfigure> {
    const descriptor: ProtocolsConfigureDescriptor = {
      method      : DwnMethodName.ProtocolsConfigure,
      dateCreated : options.dateCreated ?? getCurrentTimeInHighPrecision(),
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
