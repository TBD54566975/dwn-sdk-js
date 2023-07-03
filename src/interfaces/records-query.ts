import type { SignatureInput } from '../types/jws-types.js';
import type { Filter, RangeFilter } from '../types/message-types.js';
import type { RecordsQueryDescriptor, RecordsQueryFilter, RecordsQueryMessage } from '../types/records-types.js';

import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { Message } from '../core/message.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { validateAuthorizationIntegrity } from '../core/auth.js';
import { DwnInterfaceName, DwnMethodName } from '../core/message.js';
import { normalizeProtocolUrl, normalizeSchemaUrl, validateProtocolUrlNormalized, validateSchemaUrlNormalized } from '../utils/url.js';

export enum DateSort {
  CreatedAscending = 'createdAscending',
  CreatedDescending = 'createdDescending',
  PublishedAscending = 'publishedAscending',
  PublishedDescending = 'publishedDescending'
}

export type RecordsQueryOptions = {
  messageTimestamp?: string;
  filter: RecordsQueryFilter;
  dateSort?: DateSort;
  authorizationSignatureInput?: SignatureInput;
};

export class RecordsQuery extends Message<RecordsQueryMessage> {

  public static async parse(message: RecordsQueryMessage): Promise<RecordsQuery> {
    if (message.authorization !== undefined) {
      await validateAuthorizationIntegrity(message);
    }

    if (message.descriptor.filter.protocol !== undefined) {
      validateProtocolUrlNormalized(message.descriptor.filter.protocol);
    }
    if (message.descriptor.filter.schema !== undefined) {
      validateSchemaUrlNormalized(message.descriptor.filter.schema);
    }

    return new RecordsQuery(message);
  }

  public static async create(options: RecordsQueryOptions): Promise<RecordsQuery> {
    const descriptor: RecordsQueryDescriptor = {
      interface        : DwnInterfaceName.Records,
      method           : DwnMethodName.Query,
      messageTimestamp : options.messageTimestamp ?? getCurrentTimeInHighPrecision(),
      filter           : RecordsQuery.normalizeFilter(options.filter),
      dateSort         : options.dateSort
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    // only generate the `authorization` property if signature input is given
    const authorizationSignatureInput = options.authorizationSignatureInput;
    const authorization = authorizationSignatureInput ? await Message.signAsAuthorization(descriptor, authorizationSignatureInput) : undefined;
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new RecordsQuery(message);
  }

  public static convertFilter(filter: RecordsQueryFilter): Filter {
    const filterCopy = { ...filter };
    const { dateCreated } = filterCopy;

    let rangeFilter: RangeFilter | undefined = undefined;
    if (dateCreated !== undefined) {
      if (dateCreated.to !== undefined && dateCreated.from !== undefined) {
        rangeFilter = {
          gte : dateCreated.from,
          lt  : dateCreated.to,
        };
      } else if (dateCreated.to !== undefined) {
        rangeFilter = {
          lt: dateCreated.to,
        };
      } else if (dateCreated.from !== undefined) {
        rangeFilter = {
          gte: dateCreated.from,
        };
      }
    }

    if (rangeFilter) {
      (filterCopy as Filter).dateCreated = rangeFilter;
    }

    return filterCopy as Filter;
  }

  public static normalizeFilter(filter: RecordsQueryFilter): RecordsQueryFilter {
    let protocol;
    if (filter.protocol === undefined) {
      protocol = undefined;
    } else {
      protocol = normalizeProtocolUrl(filter.protocol);
    }

    let schema;
    if (filter.schema === undefined) {
      schema = undefined;
    } else {
      schema = normalizeSchemaUrl(filter.schema);
    }

    return {
      ...filter,
      protocol,
      schema,
    };
  }
}
