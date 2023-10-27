import type { Pagination } from '../types/message-types.js';
import type { Signer } from '../types/signer.js';
import type { RecordsFilter, RecordsQueryDescriptor, RecordsQueryMessage } from '../types/records-types.js';

import { Message } from '../core/message.js';
import { Records } from '../utils/records.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { validateMessageSignatureIntegrity } from '../core/auth.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../core/message.js';
import { getCurrentTimeInHighPrecision, validateTimestamp } from '../utils/time.js';
import { validateProtocolUrlNormalized, validateSchemaUrlNormalized } from '../utils/url.js';

export enum DateSort {
  CreatedAscending = 'createdAscending',
  CreatedDescending = 'createdDescending',
  PublishedAscending = 'publishedAscending',
  PublishedDescending = 'publishedDescending'
}

export type RecordsQueryOptions = {
  messageTimestamp?: string;
  filter: RecordsFilter;
  dateSort?: DateSort;
  pagination?: Pagination;
  authorizationSigner?: Signer;
  protocolRole?: string;
};

export class RecordsQuery extends Message<RecordsQueryMessage> {

  public static async parse(message: RecordsQueryMessage): Promise<RecordsQuery> {
    let authorizationPayload;
    if (message.authorization !== undefined) {
      authorizationPayload = await validateMessageSignatureIntegrity(message.authorization.authorSignature, message.descriptor);
    }

    if (authorizationPayload?.protocolRole !== undefined) {
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
    validateTimestamp(message.descriptor.messageTimestamp);

    return new RecordsQuery(message);
  }

  public static async create(options: RecordsQueryOptions): Promise<RecordsQuery> {
    const descriptor: RecordsQueryDescriptor = {
      interface        : DwnInterfaceName.Records,
      method           : DwnMethodName.Query,
      messageTimestamp : options.messageTimestamp ?? getCurrentTimeInHighPrecision(),
      filter           : Records.normalizeFilter(options.filter),
      dateSort         : options.dateSort,
      pagination       : options.pagination,
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    // only generate the `authorization` property if signature input is given
    const authorizationSigner = options.authorizationSigner;
    let authorization;
    if (authorizationSigner) {
      authorization = await Message.createAuthorizationAsAuthor(descriptor, authorizationSigner, { protocolRole: options.protocolRole });
    }
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new RecordsQuery(message);
  }
}
