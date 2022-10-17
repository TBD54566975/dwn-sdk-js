import type { AuthCreateOptions, Authorizable, AuthVerificationResult } from '../../../core/types';
import type { CollectionsWriteDescriptor, CollectionsWriteMessage } from '../types';
import { authenticate, authorize, validateSchema } from '../../../core/auth';
import * as encoder from '../../../utils/encoder';
import { DidResolver } from '../../../did/did-resolver';
import { getDagCid } from '../../../utils/data';
import { Jws } from '../../../jose/jws/jws';
import { Message } from '../../../core/message';
import { MessageStore } from '../../../store/message-store';
import { ProtocolAuthorization } from '../../../core/protocol-authorization';
import { removeUndefinedProperties } from '../../../utils/object';
import { validate } from '../../../validation/validator';

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
  protected message: CollectionsWriteMessage;

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

    const messageType = descriptor.method;
    validate(messageType, { descriptor, authorization: {} });

    const encodedData = encoder.bytesToBase64Url(options.data);
    const authorization = await Jws.sign({ descriptor }, options.signatureInput);
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
   * @returns newest message in the array. `undefined` if given array is empty.
   */
  static async getNewestMessage(messages: CollectionsWriteMessage[]): Promise<CollectionsWriteMessage | undefined> {
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
  static async isNewer(a: CollectionsWriteMessage, b: CollectionsWriteMessage): Promise<boolean> {
    const aIsNewer = (await CollectionsWrite.compareCreationTime(a, b) > 0);
    return aIsNewer;
  }

  /**
   * Compares the `dateCreated` of the given records with a fallback to message CID according to the spec.
   * @returns 1 if `a` is larger/newer than `b`; -1 if `a` is smaller/older than `b`; 0 otherwise (same age)
   */
  static async compareCreationTime(a: CollectionsWriteMessage, b: CollectionsWriteMessage): Promise<number> {
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


