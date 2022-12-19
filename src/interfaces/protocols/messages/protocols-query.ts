import type { AuthCreateOptions } from '../../../core/types.js';
import type { ProtocolsQueryDescriptor, ProtocolsQueryMessage } from '../types.js';

import { getCurrentTimeInHighPrecision } from '../../../utils/time.js';
import { removeUndefinedProperties } from '../../../utils/object.js';
import { validateAuthorizationIntegrity } from '../../../core/auth.js';

import { DwnMethodName, Message } from '../../../core/message.js';

export type ProtocolsQueryOptions = AuthCreateOptions & {
  target: string;
  dateCreated?: string;
  filter?: {
    protocol: string;
  }
};

export class ProtocolsQuery extends Message {
  readonly message: ProtocolsQueryMessage; // a more specific type than the base type defined in parent class

  private constructor(message: ProtocolsQueryMessage) {
    super(message);
  }

  public static async parse(message: ProtocolsQueryMessage): Promise<ProtocolsQuery> {
    await validateAuthorizationIntegrity(message);

    return new ProtocolsQuery(message);
  }

  public static async create(options: ProtocolsQueryOptions): Promise<ProtocolsQuery> {
    const descriptor: ProtocolsQueryDescriptor = {
      method      : DwnMethodName.ProtocolsQuery,
      dateCreated : options.dateCreated ?? getCurrentTimeInHighPrecision(),
      filter      : options.filter,
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    Message.validateJsonSchema({ descriptor, authorization: { } });

    const authorization = await Message.signAsAuthorization(options.target, descriptor, options.signatureInput);
    const message = { descriptor, authorization };

    const protocolsQuery = new ProtocolsQuery(message);
    return protocolsQuery;
  }
}
