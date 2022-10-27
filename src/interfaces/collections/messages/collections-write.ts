import type { AuthCreateOptions, Authorizable, AuthVerificationResult } from '../../../core/types';
import type { CollectionsWriteDescriptor, CollectionsWriteMessage } from '../types';
import * as encoder from '../../../utils/encoder';
import { authenticate, authorize, validateSchema } from '../../../core/auth';
import { DidResolver } from '../../../did/did-resolver';
import { generateCid } from '../../../utils/cid';
import { getDagCid } from '../../../utils/data';
import { Message } from '../../../core/message';
import { MessageStore } from '../../../store/message-store';
import { ProtocolAuthorization } from '../../../core/protocol-authorization';
import { removeUndefinedProperties } from '../../../utils/object';

export type CollectionsWriteOptions = AuthCreateOptions & {
  target: string;
  recipient: string;
  protocol?: string;
  contextId?: string;
  schema?: string;
  recordId: string;
  parentId?: string;
  data: Uint8Array;
  dateCreated?: number;
  published?: boolean;
  datePublished?: number;
  dataFormat: string;
};

export class CollectionsWrite extends Message implements Authorizable {
  readonly message: CollectionsWriteMessage; // a more specific type than the base type defined in parent class

  constructor(message: CollectionsWriteMessage) {
    super(message);
  }

  static async create(options: CollectionsWriteOptions): Promise<CollectionsWrite> {
    const dataCid = await getDagCid(options.data);
    const descriptor: CollectionsWriteDescriptor = {
      target        : options.target,
      recipient     : options.recipient,
      method        : 'CollectionsWrite',
      protocol      : options.protocol,
      contextId     : options.contextId,
      schema        : options.schema,
      recordId      : options.recordId,
      parentId      : options.parentId,
      dataCid       : dataCid.toString(),
      dateCreated   : options.dateCreated ?? Date.now(),
      published     : options.published,
      datePublished : options.datePublished,
      dataFormat    : options.dataFormat
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    Message.validateJsonSchema({ descriptor, authorization: { } });

    const encodedData = encoder.bytesToBase64Url(options.data);
    const authorization = await Message.signAsAuthorization(descriptor, options.signatureInput);
    const message = { descriptor, authorization, encodedData };

    return new CollectionsWrite(message);
  }

  async verifyAuth(didResolver: DidResolver, messageStore: MessageStore): Promise<AuthVerificationResult> {
    const message = this.message as CollectionsWriteMessage;

    // signature verification is computationally intensive, so we're going to start by validating the payload.
    const parsedPayload = await validateSchema(message);

    const signers = await authenticate(message.authorization, didResolver);
    const author = signers[0];

    // authorization
    if (message.descriptor.protocol !== undefined) {
      await ProtocolAuthorization.authorize(message, author, messageStore);
    } else {
      await authorize(message, author);
    }

    return { payload: parsedPayload, author };
  }

  /**
   * Computes the canonical ID of this message.
   */
  public async getCanonicalId(): Promise<string> {
    const descriptor = { ...this.message.descriptor };
    delete descriptor.target;
    (descriptor as any).author = this.author;

    const cid = await generateCid(descriptor);
    const cidString = cid.toString();
    return cidString;
  };

  /**
   * @returns newest message in the array. `undefined` if given array is empty.
   */
  public static async getNewestMessage(messages: CollectionsWriteMessage[]): Promise<CollectionsWriteMessage | undefined> {
    let currentNewestMessage: CollectionsWriteMessage | undefined = undefined;
    for (const message of messages) {
      if (currentNewestMessage === undefined || await CollectionsWrite.isNewer(message, currentNewestMessage)) {
        currentNewestMessage = message;
      }
    }

    return currentNewestMessage;
  }

  /**
   * Compares the age of two messages.
   * @returns `true` if `a` is newer than `b`; `false` otherwise
   */
  public static async isNewer(a: CollectionsWriteMessage, b: CollectionsWriteMessage): Promise<boolean> {
    const aIsNewer = (await CollectionsWrite.compareCreationTime(a, b) > 0);
    return aIsNewer;
  }

  /**
   * Compares the `dateCreated` of the given records with a fallback to message CID according to the spec.
   * @returns 1 if `a` is larger/newer than `b`; -1 if `a` is smaller/older than `b`; 0 otherwise (same age)
   */
  public static async compareCreationTime(a: CollectionsWriteMessage, b: CollectionsWriteMessage): Promise<number> {
    if (a.descriptor.dateCreated > b.descriptor.dateCreated) {
      return 1;
    } else if (a.descriptor.dateCreated < b.descriptor.dateCreated) {
      return -1;
    }

    // else `dateCreated` is the same between a and b
    // compare the `dataCid` instead, the < and > operators compare strings in lexicographical order
    return Message.compareCid(a, b);
  }
}


