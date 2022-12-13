import type { AuthCreateOptions, Authorizable } from '../../../core/types.js';
import type { CollectionsQueryDescriptor, CollectionsQueryMessage } from '../types.js';

import { DidResolver } from '../../../did/did-resolver.js';
import { DwnMethodName } from '../../../core/message.js';
import { getCurrentDateInHighPrecision } from '../../../utils/time.js';
import { Message } from '../../../core/message.js';
import { MessageStore } from '../../../store/message-store.js';
import { removeUndefinedProperties } from '../../../utils/object.js';
import { authenticate, validateAuthorizationIntegrity } from '../../../core/auth.js';

export type CollectionsQueryOptions = AuthCreateOptions & {
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
  dateSort?: string;
};

export class CollectionsQuery extends Message implements Authorizable {
  readonly message: CollectionsQueryMessage; // a more specific type than the base type defined in parent class

  private constructor(message: CollectionsQueryMessage) {
    super(message);
  }

  public static async parse(message: CollectionsQueryMessage): Promise<CollectionsQuery> {
    return new CollectionsQuery(message);
  }

  public static async create(options: CollectionsQueryOptions): Promise<CollectionsQuery> {
    const descriptor: CollectionsQueryDescriptor = {
      method      : DwnMethodName.CollectionsQuery,
      dateCreated : options.dateCreated ?? getCurrentDateInHighPrecision(),
      filter      : options.filter,
      dateSort    : options.dateSort
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    Message.validateJsonSchema({ descriptor, authorization: { } });

    const authorization = await Message.signAsAuthorization(options.target, descriptor, options.signatureInput);
    const message = { descriptor, authorization };

    return new CollectionsQuery(message);
  }

  async verifyAuth(didResolver: DidResolver, _messageStore: MessageStore): Promise<void> {
    const message = this.message;

    // signature verification is computationally intensive, so we're going to start by validating the payload.
    await validateAuthorizationIntegrity(message);

    const signers = await authenticate(message.authorization, didResolver);
    const author = signers[0];

    const recipientDid = this.message.descriptor.filter.recipient;
    if (recipientDid !== undefined &&
        recipientDid !== author) {
      throw new Error(`non-owner ${author}, not allowed to query records intended for ${recipientDid}`);
    }
  }
}
