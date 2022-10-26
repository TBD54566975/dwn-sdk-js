import type { AuthCreateOptions, Authorizable, AuthVerificationResult } from '../../../core/types';
import type { CollectionsQueryDescriptor, CollectionsQueryMessage } from '../types';
import { authenticate, validateSchema } from '../../../core/auth';
import { DidResolver } from '../../../did/did-resolver';
import { Jws } from '../../../jose/jws/jws';
import { Message } from '../../../core/message';
import { MessageStore } from '../../../store/message-store';
import { removeUndefinedProperties } from '../../../utils/object';
import { validate } from '../../../validation/validator';

export type CollectionsQueryOptions = AuthCreateOptions & {
  target: string;
  dateCreated?: number;
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
      target      : options.target,
      method      : 'CollectionsQuery',
      dateCreated : options.dateCreated ?? Date.now(),
      filter      : options.filter,
      dateSort    : options.dateSort
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    const messageType = descriptor.method;
    validate(messageType, { descriptor, authorization: {} });

    const authorization = await Jws.sign({ descriptor }, options.signatureInput);
    const message = { descriptor, authorization };

    return new CollectionsQuery(message);
  }

  async verifyAuth(didResolver: DidResolver, _messageStore: MessageStore): Promise<AuthVerificationResult> {
    const message = this.message;

    // signature verification is computationally intensive, so we're going to start by validating the payload.
    const parsedPayload = await validateSchema(message);

    const signers = await authenticate(message.authorization, didResolver);
    const author = signers[0];

    const recipientDid = this.message.descriptor.filter.recipient;
    if (recipientDid !== undefined &&
        recipientDid !== author) {
      throw new Error(`non-owner ${author}, not allowed to query records intended for ${recipientDid}`);
    }

    return { payload: parsedPayload, author };
  }
}
