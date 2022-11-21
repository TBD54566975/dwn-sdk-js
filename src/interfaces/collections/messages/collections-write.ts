import type { AuthCreateOptions, Authorizable, AuthVerificationResult } from '../../../core/types';
import type { CollectionsWriteAuthorizationPayload, CollectionsWriteDescriptor, CollectionsWriteMessage } from '../types';
import * as encoder from '../../../utils/encoder';
import { authenticate, authorize, validateSchema } from '../../../core/auth';
import { DidResolver } from '../../../did/did-resolver';
import { generateCid } from '../../../utils/cid';
import { getDagCid } from '../../../utils/data';
import { getCurrentDateInHighPrecision } from '../../../utils/time';
import { GeneralJws, SignatureInput } from '../../../jose/jws/general/types';
import { GeneralJwsSigner, GeneralJwsVerifier } from '../../../jose/jws/general';
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
  dateCreated?: string;
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
      schema        : options.schema,
      recordId      : options.recordId,
      parentId      : options.parentId,
      dataCid       : dataCid.toString(),
      dateCreated   : options.dateCreated ?? getCurrentDateInHighPrecision(),
      published     : options.published,
      datePublished : options.datePublished,
      dataFormat    : options.dataFormat
    };

    // generate `datePublished` if the message is to be published but `datePublished` is not given
    if (options.published === true &&
        options.datePublished === undefined) {
      descriptor.datePublished = Date.now();
    }

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    const author = GeneralJwsVerifier.extractDid(options.signatureInput.protectedHeader.kid);

    // `contextId` computation
    let contextId: string | undefined;
    if (options.contextId !== undefined) {
      contextId = options.contextId;
    } else { // `contextId` is undefined
      // we compute the contextId for the caller if `protocol` is specified but not the `contextId`
      if (descriptor.protocol !== undefined) {
        contextId = await CollectionsWrite.getCanonicalId(author, descriptor);
      }
    }

    const encodedData = encoder.bytesToBase64Url(options.data);
    const authorization = await CollectionsWrite.signAsCollectionsWriteAuthorization(contextId, descriptor, options.signatureInput);
    const message: CollectionsWriteMessage = {
      descriptor,
      authorization,
      encodedData
    };

    if (contextId !== undefined) { message.contextId = contextId; } // assign `contextId` only if it is defined

    Message.validateJsonSchema(message);

    return new CollectionsWrite(message);
  }

  async verifyAuth(didResolver: DidResolver, messageStore: MessageStore): Promise<AuthVerificationResult> {
    const message = this.message as CollectionsWriteMessage;

    // signature verification is computationally intensive, so we're going to start by validating the payload.
    const parsedPayload = await validateSchema(message, { allowedProperties: new Set(['contextId']) });

    await this.validateIntegrity();

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
   * Validates the integrity of the message assuming the message passed basic schema validation.
   * There is opportunity to integrate better with `validateSchema(...)`
   */
  private async validateIntegrity(): Promise<void> {
    // if the message is a root protocol message, the `contextId` must match the expected computed value
    if (this.message.descriptor.protocol !== undefined &&
        this.message.descriptor.parentId === undefined) {
      const expectedContextId = await this.getCanonicalId();

      if (this.message.contextId !== expectedContextId) {
        throw new Error(`contextId in message: ${this.message.contextId} does not match computed contextId: ${expectedContextId}`);
      }
    }

    // if `contextId` is given in message, make sure the same `contextId` is in the `authorization`
    if (this.message.contextId !== this.authorizationPayload.contextId) {
      throw new Error(
        `contextId in message ${this.message.contextId} does not match contextId in authorization: ${this.authorizationPayload.contextId}`
      );
    }
  }

  /**
   * Computes the canonical ID of this message.
   */
  public async getCanonicalId(): Promise<string> {
    const canonicalId = await CollectionsWrite.getCanonicalId(this.author, this.message.descriptor);
    return canonicalId;
  };

  /**
   * Computes the canonical ID of this message.
   */
  public static async getCanonicalId(author: string, descriptor: CollectionsWriteDescriptor): Promise<string> {
    const canonicalIdInput = { ...descriptor };
    delete canonicalIdInput.target;
    (canonicalIdInput as any).author = author;

    const cid = await generateCid(canonicalIdInput);
    const cidString = cid.toString();
    return cidString;
  };

  /**
   * Creates the `authorization` property for a CollectionsWrite message.
   */
  private static async signAsCollectionsWriteAuthorization(
    contextId: string | undefined,
    descriptor: CollectionsWriteDescriptor,
    signatureInput: SignatureInput
  ): Promise<GeneralJws> {
    const descriptorCid = await generateCid(descriptor);

    const authorizationPayload: CollectionsWriteAuthorizationPayload = { descriptorCid: descriptorCid.toString() };

    if (contextId !== undefined) { authorizationPayload.contextId = contextId; } // assign `contextId` only if it is defined

    const authorizationPayloadBytes = encoder.objectToBytes(authorizationPayload);

    const signer = await GeneralJwsSigner.create(authorizationPayloadBytes, [signatureInput]);

    return signer.getJws();
  }

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


