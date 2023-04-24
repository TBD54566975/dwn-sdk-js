import type { SignatureInput } from '../../../jose/jws/general/types.js';
import type { ProtocolsQueryDescriptor, ProtocolsQueryFilter, ProtocolsQueryMessage } from '../types.js';

import { getCurrentTimeInHighPrecision } from '../../../utils/time.js';
import { removeUndefinedProperties } from '../../../utils/object.js';
import { validateAuthorizationIntegrity } from '../../../core/auth.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../../../core/message.js';
import { normalizeProtocolUri, validateProtocolUriNormalized } from '../../../utils/url.js';

export type ProtocolsQueryOptions = {
  dateCreated?: string;
  filter?: ProtocolsQueryFilter,
  authorizationSignatureInput: SignatureInput;
};

export class ProtocolsQuery extends Message<ProtocolsQueryMessage> {

  public static async parse(message: ProtocolsQueryMessage): Promise<ProtocolsQuery> {
    await validateAuthorizationIntegrity(message);

    if (message.descriptor.filter !== undefined) {
      validateProtocolUriNormalized(message.descriptor.filter.protocol);
    }

    return new ProtocolsQuery(message);
  }

  public static async create(options: ProtocolsQueryOptions): Promise<ProtocolsQuery> {
    const descriptor: ProtocolsQueryDescriptor = {
      interface   : DwnInterfaceName.Protocols,
      method      : DwnMethodName.Query,
      dateCreated : options.dateCreated ?? getCurrentTimeInHighPrecision(),
      filter      : ProtocolsQuery.normalizeFilter(options.filter),
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    Message.validateJsonSchema({ descriptor, authorization: { } });

    const authorization = await Message.signAsAuthorization(descriptor, options.authorizationSignatureInput);
    const message = { descriptor, authorization };

    const protocolsQuery = new ProtocolsQuery(message);
    return protocolsQuery;
  }

  private static normalizeFilter(filter: ProtocolsQueryFilter | undefined): ProtocolsQueryFilter | undefined {
    if (filter === undefined) {
      return undefined;
    }

    return {
      ...filter,
      protocol: normalizeProtocolUri(filter.protocol),
    };
  }
}
