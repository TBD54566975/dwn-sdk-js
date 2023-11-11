import type { DelegatedGrantMessage } from '../types/delegated-grant-message.js';
import type { Pagination } from '../types/message-types.js';
import type { Signer } from '../types/signer.js';
import type { DateSort, RecordsFilter, RecordsQueryDescriptor, RecordsQueryMessage } from '../types/records-types.js';

import { AbstractMessage } from '../core/abstract-message.js';
import { Message } from '../core/message.js';
import { Records } from '../utils/records.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { Time } from '../utils/time.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';
import { validateProtocolUrlNormalized, validateSchemaUrlNormalized } from '../utils/url.js';

export type RecordsQueryOptions = {
  messageTimestamp?: string;
  filter: RecordsFilter;
  dateSort?: DateSort;
  pagination?: Pagination;
  signer?: Signer;
  protocolRole?: string;

  /**
   * The delegated grant to sign on behalf of the logical author, which is the grantor (`grantedBy`) of the delegated grant.
   */
  delegatedGrant?: DelegatedGrantMessage;
};

/**
 * A class representing a RecordsQuery DWN message.
 */
export class RecordsQuery extends AbstractMessage<RecordsQueryMessage> {

  public static async parse(message: RecordsQueryMessage): Promise<RecordsQuery> {
    let signaturePayload;
    if (message.authorization !== undefined) {
      signaturePayload = await Message.validateMessageSignatureIntegrity(message.authorization.signature, message.descriptor);
    }

    Records.validateDelegatedGrantReferentialIntegrity(message, signaturePayload);

    if (signaturePayload?.protocolRole !== undefined) {
      if (message.descriptor.filter.protocolPath === undefined) {
        throw new DwnError(
          DwnErrorCode.RecordsQueryFilterMissingRequiredProperties,
          'Role-authorized queries must include `protocolPath` in the filter'
        );
      }
    }
    if (message.descriptor.filter.protocol !== undefined) {
      validateProtocolUrlNormalized(message.descriptor.filter.protocol);
    }
    if (message.descriptor.filter.schema !== undefined) {
      validateSchemaUrlNormalized(message.descriptor.filter.schema);
    }

    Time.validateTimestamp(message.descriptor.messageTimestamp);

    return new RecordsQuery(message);
  }

  public static async create(options: RecordsQueryOptions): Promise<RecordsQuery> {
    const descriptor: RecordsQueryDescriptor = {
      interface        : DwnInterfaceName.Records,
      method           : DwnMethodName.Query,
      messageTimestamp : options.messageTimestamp ?? Time.getCurrentTimestamp(),
      filter           : Records.normalizeFilter(options.filter),
      dateSort         : options.dateSort,
      pagination       : options.pagination,
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    // only generate the `authorization` property if signature input is given
    const signer = options.signer;
    let authorization;
    if (signer) {
      authorization = await Message.createAuthorization({
        descriptor,
        signer,
        protocolRole   : options.protocolRole,
        delegatedGrant : options.delegatedGrant
      });
    }
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new RecordsQuery(message);
  }
}
