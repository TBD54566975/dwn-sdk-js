import type { AuthCreateOptions } from '../../../core/types';
import type { ProtocolDefinition, ProtocolsConfigureDescriptor, ProtocolsConfigureMessage } from '../types';
import { Jws } from '../../../jose/jws/jws';
import { validate } from '../../../validation/validator';

export type ProtocolsConfigureOptions = AuthCreateOptions & {
  target: string;
  dateCreated? : number;
  protocol: string;
  definition : ProtocolDefinition;
};

export class ProtocolsConfigure {
  static async create(options: ProtocolsConfigureOptions): Promise<ProtocolsConfigureMessage> {
    const descriptor: ProtocolsConfigureDescriptor = {
      target      : options.target,
      method      : 'ProtocolsConfigure',
      dateCreated : options.dateCreated ?? Date.now(),
      protocol    : options.protocol,
      definition  : options.definition
    };

    const messageType = descriptor.method;
    validate(messageType, { descriptor, authorization: {} });

    const authorization = await Jws.sign({ descriptor }, options.signatureInput);
    const message = { descriptor, authorization };

    return message;
  }
}
