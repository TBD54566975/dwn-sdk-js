import type { AuthCreateOptions } from '../../../core/types.js';
import type { RecordsQueryDescriptor, RecordsQueryMessage } from '../types.js';

import { DwnMethodName } from '../../../core/message.js';
import { getCurrentTimeInHighPrecision } from '../../../utils/time.js';
import { Message } from '../../../core/message.js';
import { removeUndefinedProperties } from '../../../utils/object.js';
import { validateAuthorizationIntegrity } from '../../../core/auth.js';

export enum DateSort {
  CreatedAscending = 'createdAscending',
  CreatedDescending = 'createdDescending',
  PublishedAscending = 'publishedAscending',
  PublishedDescending = 'publishedDescending'
}

export type RecordsQueryOptions = AuthCreateOptions & {
  target: string;
  dateCreated?: string;
  filter: {
    recipient?: string;
    protocol?: string;
    contextId?: string;
    schema?: string;
    recordId?: string;
    parentId?: string;
    dataFormat?: string;
  },
  dateSort?: DateSort;
};

export class RecordsQuery extends Message {
  readonly message: RecordsQueryMessage; // a more specific type than the base type defined in parent class

  private constructor(message: RecordsQueryMessage) {
    super(message);
  }

  public static async parse(message: RecordsQueryMessage): Promise<RecordsQuery> {
    await validateAuthorizationIntegrity(message);
    return new RecordsQuery(message);
  }

  public static async create(options: RecordsQueryOptions): Promise<RecordsQuery> {
    const descriptor: RecordsQueryDescriptor = {
      method      : DwnMethodName.RecordsQuery,
      dateCreated : options.dateCreated ?? getCurrentTimeInHighPrecision(),
      filter      : options.filter,
      dateSort    : options.dateSort
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    Message.validateJsonSchema({ descriptor, authorization: { } });

    const authorization = await Message.signAsAuthorization(options.target, descriptor, options.signatureInput);
    const message = { descriptor, authorization };

    return new RecordsQuery(message);
  }

  public async authorize(): Promise<void> {
    // DWN owner can do any query
    if (this.author === this.target) {
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
}
