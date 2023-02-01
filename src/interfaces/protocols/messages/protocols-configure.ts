import type { SignatureInput } from '../../../jose/jws/general/types.js';
import type { ProtocolDefinition, ProtocolsConfigureDescriptor, ProtocolsConfigureMessage } from '../types.js';

import { getCurrentTimeInHighPrecision } from '../../../utils/time.js';
import { validateAuthorizationIntegrity } from '../../../core/auth.js';

import { DwnInterfaceName, DwnMethodName, Message } from '../../../core/message.js';

export type ProtocolsConfigureOptions = {
  dateCreated? : string;
  protocol: string;
  definition : ProtocolDefinition;
  authorizationSignatureInput: SignatureInput;
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
      interface   : DwnInterfaceName.Protocols,
      method      : DwnMethodName.Configure,
      dateCreated : options.dateCreated ?? getCurrentTimeInHighPrecision(),
      protocol    : options.protocol,
      definition  : options.definition
    };

    Message.validateJsonSchema({ descriptor, authorization: { } });

    const authorization = await Message.signAsAuthorization(descriptor, options.authorizationSignatureInput);
    const message = { descriptor, authorization };

    const protocolsConfigure = new ProtocolsConfigure(message);
    return protocolsConfigure;
  }
}
