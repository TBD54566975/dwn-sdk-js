import type { AuthCreateOptions, Authorizable, AuthVerificationResult } from '../../../core/types.js';
import type { CollectionsWriteAuthorizationPayload, CollectionsWriteDescriptor, CollectionsWriteMessage } from '../types.js';

import { DidResolver } from '../../../did/did-resolver.js';
import { DwnMethodName } from '../../../core/message.js';
import { Encoder } from '../../../utils/encoder.js';
import { getCurrentDateInHighPrecision } from '../../../utils/time.js';
import { Message } from '../../../core/message.js';
import { MessageStore } from '../../../store/message-store.js';
import { ProtocolAuthorization } from '../../../core/protocol-authorization.js';
import { removeUndefinedProperties } from '../../../utils/object.js';

import { authenticate, authorize, validateAuthorizationIntegrity } from '../../../core/auth.js';
import { GeneralJws, SignatureInput } from '../../../jose/jws/general/types.js';
import { GeneralJwsSigner, GeneralJwsVerifier } from '../../../jose/jws/general/index.js';
import { generateCid, getDagPbCid } from '../../../utils/cid.js';

export type CollectionsWriteOptions = AuthCreateOptions & {
  target: string;
  recipient: string;
  protocol?: string;
  contextId?: string;
  schema?: string;
  recordId?: string;
  lineageParent? : string;
  parentId?: string;
  data: Uint8Array;
  dateCreated?: string;
  published?: boolean;
  datePublished?: number;
  dataFormat: string;
};

export class CollectionsWrite extends Message implements Authorizable {
  readonly message: CollectionsWriteMessage; // a more specific type than the base type defined in parent class

  private constructor(message: CollectionsWriteMessage) {
    super(message);
  }

  public static async parse(message: CollectionsWriteMessage): Promise<CollectionsWrite> {
    return new CollectionsWrite(message);
  }

  /**
   * Creates a CollectionsWrite message.
   * @param options.recordId If `undefined`, will be auto-filled as a originating message as convenience for developer.
   * @param options.lineageParent If `undefined`, it will be auto-filled with value of `options.recordId` as convenience for developer.
   */
  public static async create(options: CollectionsWriteOptions): Promise<CollectionsWrite> {
    const dataCid = await getDagPbCid(options.data);
    const descriptor: CollectionsWriteDescriptor = {
      recipient     : options.recipient,
      method        : DwnMethodName.CollectionsWrite,
      protocol      : options.protocol,
      schema        : options.schema,
      lineageParent : options.lineageParent ?? options.recordId, // convenience for developer
      parentId      : options.parentId,
      dataCid       : dataCid.toString(),
      dateCreated   : options.dateCreated ?? getCurrentDateInHighPrecision(),
      published     : options.published,
      datePublished : options.datePublished,
      dataFormat    : options.dataFormat
    };

    // TODO: https://github.com/TBD54566975/dwn-sdk-js/issues/145 - Change datePublished to higher precision format (ISO 8601)
    // generate `datePublished` if the message is to be published but `datePublished` is not given
    if (options.published === true &&
        options.datePublished === undefined) {
      descriptor.datePublished = Date.now();
    }

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    const author = GeneralJwsVerifier.extractDid(options.signatureInput.protectedHeader.kid);

    // `recordId` computation
    let recordId: string | undefined;
    if (options.recordId !== undefined) {
      recordId = options.recordId;
    } else { // `recordId` is undefined
      recordId = await CollectionsWrite.getCanonicalId(author, descriptor);

      // lineageParent must not exist if this message is the originating message
      if (options.lineageParent !== undefined) {
        throw new Error('originating message must not have a lineage parent');
      }
    }

    // `contextId` computation
    let contextId: string | undefined;
    if (options.contextId !== undefined) {
      contextId = options.contextId;
    } else { // `contextId` is undefined
      // we compute the contextId for the caller if `protocol` is specified (this is the case of the root message of a protocol context)
      if (descriptor.protocol !== undefined) {
        contextId = await CollectionsWrite.getCanonicalId(author, descriptor);
      }
    }

    const encodedData = Encoder.bytesToBase64Url(options.data);
    const authorization = await CollectionsWrite.signAsCollectionsWriteAuthorization(
      options.target,
      recordId,
      contextId,
      descriptor,
      options.signatureInput
    );
    const message: CollectionsWriteMessage = {
      recordId,
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
    const parsedPayload = await validateAuthorizationIntegrity(message, { allowedProperties: new Set(['recordId', 'contextId']) });

    await this.validateIntegrity();

    const signers = await authenticate(message.authorization, didResolver);
    const author = signers[0];

    // authorization
    if (message.descriptor.protocol !== undefined) {
      await ProtocolAuthorization.authorize(this, author, messageStore);
    } else {
      await authorize(this);
    }

    return { payload: parsedPayload, author };
  }

  /**
   * Validates the integrity of the CollectionsWrite message assuming the message passed basic schema validation.
   * There is opportunity to integrate better with `validateSchema(...)`
   */
  private async validateIntegrity(): Promise<void> {
    // make sure the same `recordId` in message is the same as the `recordId` in `authorization`
    if (this.message.recordId !== this.authorizationPayload.recordId) {
      throw new Error(
        `recordId in message ${this.message.recordId} does not match recordId in authorization: ${this.authorizationPayload.recordId}`
      );
    }

    // if the message is a originating message, the `recordId` must match the expected deterministic value
    if (this.message.descriptor.lineageParent === undefined) {
      const expectedRecordId = await this.getCanonicalId();

      if (this.message.recordId !== expectedRecordId) {
        throw new Error(`recordId in message: ${this.message.recordId} does not match deterministic recordId: ${expectedRecordId}`);
      }
    }

    // if the message is a root protocol message, the `contextId` must match the expected deterministic value
    if (this.message.descriptor.protocol !== undefined &&
        this.message.descriptor.parentId === undefined) {
      const expectedContextId = await this.getCanonicalId();

      if (this.message.contextId !== expectedContextId) {
        throw new Error(`contextId in message: ${this.message.contextId} does not match deterministic contextId: ${expectedContextId}`);
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
    (canonicalIdInput as any).author = author;

    const cid = await generateCid(canonicalIdInput);
    const cidString = cid.toString();
    return cidString;
  };

  /**
   * Creates the `authorization` property for a CollectionsWrite message.
   */
  private static async signAsCollectionsWriteAuthorization(
    target: string,
    recordId: string,
    contextId: string | undefined,
    descriptor: CollectionsWriteDescriptor,
    signatureInput: SignatureInput
  ): Promise<GeneralJws> {
    const descriptorCid = await generateCid(descriptor);

    const authorizationPayload: CollectionsWriteAuthorizationPayload = {
      target,
      recordId,
      descriptorCid: descriptorCid.toString()
    };

    if (contextId !== undefined) { authorizationPayload.contextId = contextId; } // assign `contextId` only if it is defined

    const authorizationPayloadBytes = Encoder.objectToBytes(authorizationPayload);

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
   * Checks if first message is newer than second message.
   * @returns `true` if `a` is newer than `b`; `false` otherwise
   */
  public static async isNewer(a: CollectionsWriteMessage, b: CollectionsWriteMessage): Promise<boolean> {
    const aIsNewer = (await CollectionsWrite.compareCreationTime(a, b) > 0);
    return aIsNewer;
  }

  /**
   * Checks if first message is older than second message.
   * @returns `true` if `a` is older than `b`; `false` otherwise
   */
  public static async isOlder(a: CollectionsWriteMessage, b: CollectionsWriteMessage): Promise<boolean> {
    const aIsNewer = (await CollectionsWrite.compareCreationTime(a, b) < 0);
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


