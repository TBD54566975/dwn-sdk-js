import type { SignatureInput } from '../../../jose/jws/general/types.js';
import type { Filter, RangeFilter } from '../../../core/types.js';
import type { RecordsQueryDescriptor, RecordsQueryFilter, RecordsQueryMessage } from '../types.js';

import { getCurrentTimeInHighPrecision } from '../../../utils/time.js';
import { Message } from '../../../core/message.js';
import { removeUndefinedProperties } from '../../../utils/object.js';
import { validateAuthorizationIntegrity } from '../../../core/auth.js';
import { DwnInterfaceName, DwnMethodName } from '../../../core/message.js';

export enum DateSort {
  CreatedAscending = 'createdAscending',
  CreatedDescending = 'createdDescending',
  PublishedAscending = 'publishedAscending',
  PublishedDescending = 'publishedDescending'
}

export type RecordsQueryOptions = {
  dateCreated?: string;
  filter: RecordsQueryFilter;
  dateSort?: DateSort;
  authorizationSignatureInput: SignatureInput;
};

export class RecordsQuery extends Message<RecordsQueryMessage> {

  public static async parse(message: RecordsQueryMessage): Promise<RecordsQuery> {
    await validateAuthorizationIntegrity(message);
    return new RecordsQuery(message);
  }

  public static async create(options: RecordsQueryOptions): Promise<RecordsQuery> {
    const descriptor: RecordsQueryDescriptor = {
      interface   : DwnInterfaceName.Records,
      method      : DwnMethodName.Query,
      dateCreated : options.dateCreated ?? getCurrentTimeInHighPrecision(),
      filter      : options.filter,
      dateSort    : options.dateSort
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    const authorization = await Message.signAsAuthorization(descriptor, options.authorizationSignatureInput);
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new RecordsQuery(message);
  }

  public async authorize(tenant: string): Promise<void> {
    // DWN owner can do any query
    if (this.author === tenant) {
      return;
    }

    // extra checks if a recipient filter is specified
    const recipientDid = this.message.descriptor.filter.recipient;
    if (recipientDid !== undefined) {
      // make sure the recipient is the author
      if (recipientDid !== this.author) {
        throw new Error(`${this.author} is not allowed to query records intended for another recipient: ${recipientDid}`);
      }
    }
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
}
