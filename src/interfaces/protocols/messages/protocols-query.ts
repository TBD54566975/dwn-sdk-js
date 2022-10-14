import type { AuthCreateOptions } from '../../../core/types';
import type { ProtocolsQueryDescriptor, ProtocolsQueryMessage } from '../types';
import { Jws } from '../../../jose/jws/jws';
import { removeUndefinedProperties } from '../../../utils/object';
import { validate } from '../../../validation/validator';

export type ProtocolsQueryOptions = AuthCreateOptions & {
  target: string;
  dateCreated?: number;
  filter?: {
    protocol: string;
  }
};

export class ProtocolsQuery {
  static async create(options: ProtocolsQueryOptions): Promise<ProtocolsQueryMessage> {
    const descriptor: ProtocolsQueryDescriptor = {
      target      : options.target,
      method      : 'ProtocolsQuery',
      dateCreated : options.dateCreated ?? Date.now(),
      filter      : options.filter,
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    const messageType = descriptor.method;
    validate(messageType, { descriptor, authorization: {} });

    const authorization = await Jws.sign({ descriptor }, options.signatureInput);
    const message = { descriptor, authorization };

    return message;
  }
}
