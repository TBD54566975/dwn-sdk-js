import type { AuthorizationModel } from '../types/message-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { Signer } from '../types/signer.js';
import type { ProtocolsQueryDescriptor, ProtocolsQueryFilter, ProtocolsQueryMessage } from '../types/protocols-types.js';

import { AbstractMessage } from '../core/abstract-message.js';
import { GrantAuthorization } from '../core/grant-authorization.js';
import { Message } from '../core/message.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { Time } from '../utils/time.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';
import { normalizeProtocolUrl, validateProtocolUrlNormalized } from '../utils/url.js';

import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

export type ProtocolsQueryOptions = {
  messageTimestamp?: string;
  filter?: ProtocolsQueryFilter,
  signer?: Signer;
  permissionsGrantId?: string;
};

export class ProtocolsQuery extends AbstractMessage<ProtocolsQueryMessage> {

  public static async parse(message: ProtocolsQueryMessage): Promise<ProtocolsQuery> {
    if (message.authorization !== undefined) {
      await Message.validateMessageSignatureIntegrity(message.authorization.signature, message.descriptor);
    }

    if (message.descriptor.filter !== undefined) {
      validateProtocolUrlNormalized(message.descriptor.filter.protocol);
    }
    Time.validateTimestamp(message.descriptor.messageTimestamp);

    return new ProtocolsQuery(message);
  }

  public static async create(options: ProtocolsQueryOptions): Promise<ProtocolsQuery> {
    const descriptor: ProtocolsQueryDescriptor = {
      interface        : DwnInterfaceName.Protocols,
      method           : DwnMethodName.Query,
      messageTimestamp : options.messageTimestamp ?? Time.getCurrentTimestamp(),
      filter           : ProtocolsQuery.normalizeFilter(options.filter),
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    // only generate the `authorization` property if signature input is given
    let authorization: AuthorizationModel | undefined;
    if (options.signer !== undefined) {
      authorization = await Message.createAuthorization({
        descriptor,
        signer             : options.signer,
        permissionsGrantId : options.permissionsGrantId
      });
    }

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

  public async authorize(tenant: string, messageStore: MessageStore): Promise<void> {
    // if author is the same as the target tenant, we can directly grant access
    if (this.author === tenant) {
      return;
    } else if (this.author !== undefined && this.signaturePayload!.permissionsGrantId) {
      await GrantAuthorization.authorizeGenericMessage(
        tenant,
        this,
        this.author,
        this.signaturePayload!.permissionsGrantId,
        messageStore
      );
    } else {
      throw new DwnError(
        DwnErrorCode.ProtocolsQueryUnauthorized,
        'The ProtocolsQuery failed authorization'
      );
    }
  }
}
