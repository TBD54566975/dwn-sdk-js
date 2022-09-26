import type { AuthCreateOptions, Authorizable, AuthVerificationResult } from '../../../core/types';
import type { CollectionsQueryDescriptor, CollectionsQueryMessage } from '../types';
import { DIDResolver } from '../../../did/did-resolver';
import { Message } from '../../../core/message';
import { MessageStore } from '../../../store/message-store';
import { removeUndefinedProperties } from '../../../utils/object';
import { sign, verifyAuth } from '../../../core/auth';
import { validate } from '../../../validation/validator';

export type CollectionsQueryOptions = AuthCreateOptions & {
  target: string;
  nonce: string;
  filter: {
    recipient?: string;
    protocol?: string;
    contextId?: string;
    schema?: string;
    recordId?: string;
    parentId?: string;
    dataFormat?: string;
  },
  dateSort?: string;
};

export class CollectionsQuery extends Message implements Authorizable {
  protected message: CollectionsQueryMessage;

  constructor(message: CollectionsQueryMessage) {
    super(message);
  }

  static async create(options: CollectionsQueryOptions): Promise<CollectionsQuery> {
    const descriptor: CollectionsQueryDescriptor = {
      target   : options.target,
      method   : 'CollectionsQuery',
      nonce    : options.nonce,
      filter   : options.filter,
      dateSort : options.dateSort
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    const messageType = descriptor.method;
    validate(messageType, { descriptor, authorization: {} });

    const authorization = await sign({ descriptor }, options.signatureInput);
    const message = { descriptor, authorization };

    return new CollectionsQuery(message);
  }

  async verifyAuth(didResolver: DIDResolver, messageStore: MessageStore): Promise<AuthVerificationResult> {
    // TODO: Issue #75 - Add permission verification - https://github.com/TBD54566975/dwn-sdk-js/issues/75
    return await verifyAuth(this.message, didResolver, messageStore);
  }
}
