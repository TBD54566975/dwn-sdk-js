import type { SignatureInput } from '../types/jws-types.js';
import type { ProtocolsQueryDescriptor, ProtocolsQueryFilter, ProtocolsQueryMessage } from '../types/protocols-types.js';

import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { validateAuthorizationIntegrity } from '../core/auth.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';
import { normalizeProtocolUrl, validateProtocolUrlNormalized } from '../utils/url.js';

export type ProtocolsQueryOptions = {
  messageTimestamp?: string;
  filter?: ProtocolsQueryFilter,
  authorizationSignatureInput: SignatureInput;
};

export class ProtocolsQuery extends Message<ProtocolsQueryMessage> {

  public static async parse(message: ProtocolsQueryMessage): Promise<ProtocolsQuery> {
    await validateAuthorizationIntegrity(message);

    if (message.descriptor.filter !== undefined) {
      validateProtocolUrlNormalized(message.descriptor.filter.protocol);
    }

    return new ProtocolsQuery(message);
  }

  public static async create(options: ProtocolsQueryOptions): Promise<ProtocolsQuery> {
    const descriptor: ProtocolsQueryDescriptor = {
      interface        : DwnInterfaceName.Protocols,
      method           : DwnMethodName.Query,
      messageTimestamp : options.messageTimestamp ?? getCurrentTimeInHighPrecision(),
      filter           : ProtocolsQuery.normalizeFilter(options.filter),
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    const authorization = await Message.signAsAuthorization(descriptor, options.authorizationSignatureInput);
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);

    const protocolsQuery = new ProtocolsQuery(message);
    return protocolsQuery;
  }

  private static normalizeFilter(filter: ProtocolsQueryFilter | undefined): ProtocolsQueryFilter | undefined {
    if (filter === undefined) {
      return undefined;
    }

    return {
      ...filter,
      protocol: normalizeProtocolUrl(filter.protocol),
    };
  }
}
