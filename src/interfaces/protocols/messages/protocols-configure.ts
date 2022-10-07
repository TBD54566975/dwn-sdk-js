import type { AuthCreateOptions } from '../../../core/types';
import type { ProtocolDefinition, ProtocolsConfigureDescriptor, ProtocolsConfigureMessage } from '../types';
import randomBytes from 'randombytes';
import { base64url } from 'multiformats/bases/base64';
import { Jws } from '../../../jose/jws/jws';
import { validate } from '../../../validation/validator';

export type ProtocolsConfigureOptions = AuthCreateOptions & {
  target: string;
  protocol: string;
  definition : ProtocolDefinition;
};

export class ProtocolsConfigure {
  static async create(options: ProtocolsConfigureOptions): Promise<ProtocolsConfigureMessage> {
    const nonceBytes = randomBytes(32);
    const nonce = base64url.baseEncode(nonceBytes);

    const descriptor: ProtocolsConfigureDescriptor = {
      target     : options.target,
      method     : 'ProtocolsConfigure',
      protocol   : options.protocol,
      nonce,
      definition : options.definition
    };

    const messageType = descriptor.method;
    validate(messageType, { descriptor, authorization: {} });

    const authorization = await Jws.sign({ descriptor }, options.signatureInput);
    const message = { descriptor, authorization };

    return message;
  }
}
