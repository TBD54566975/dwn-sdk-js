import type { AuthCreateOptions } from '../../../core/types';
import type { ProtocolsQueryDescriptor, ProtocolsQueryMessage } from '../types';
import { Message } from '../../../core';
import { removeUndefinedProperties } from '../../../utils/object';
import { getCurrentDateInHighPrecision } from '../../../utils/time';
import { DwnMethodName } from '../../../core/message';

export type ProtocolsQueryOptions = AuthCreateOptions & {
  target: string;
  dateCreated?: string;
  filter?: {
    protocol: string;
  }
};

export class ProtocolsQuery extends Message {
  readonly message: ProtocolsQueryMessage; // a more specific type than the base type defined in parent class

  constructor(message: ProtocolsQueryMessage) {
    super(message);
  }

  static async create(options: ProtocolsQueryOptions): Promise<ProtocolsQuery> {
    const descriptor: ProtocolsQueryDescriptor = {
      target      : options.target,
      method      : DwnMethodName.ProtocolsQuery,
      dateCreated : options.dateCreated ?? getCurrentDateInHighPrecision(),
      filter      : options.filter,
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    Message.validateJsonSchema({ descriptor, authorization: { } });

    const authorization = await Message.signAsAuthorization(descriptor, options.signatureInput);
    const message = { descriptor, authorization };

    const protocolsQuery = new ProtocolsQuery(message);
    return protocolsQuery;
  }
}
