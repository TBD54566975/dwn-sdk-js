import type { AuthCreateOptions } from '../../../core/types';
import type { ProtocolDefinition, ProtocolsConfigureDescriptor, ProtocolsConfigureMessage } from '../types';
import { Message } from '../../../core';
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

    const authorization = await Message.signAsAuthorization(descriptor, options.signatureInput);
    const message = { descriptor, authorization };

    return message;
  }
}
