import type { AuthCreateOptions } from '../../../core/types.js';
import type { CollectionsWriteAuthorizationPayload, CollectionsWriteDescriptor, CollectionsWriteMessage } from '../types.js';

import { DwnMethodName } from '../../../core/message.js';
import { Encoder } from '../../../utils/encoder.js';
import { GeneralJwsSigner } from '../../../jose/jws/general/signer.js';
import { GeneralJwsVerifier } from '../../../jose/jws/general/verifier.js';
import { getCurrentTimeInHighPrecision } from '../../../utils/time.js';
import { Message } from '../../../core/message.js';
import { MessageStore } from '../../../store/message-store.js';
import { ProtocolAuthorization } from '../../../core/protocol-authorization.js';
import { removeUndefinedProperties } from '../../../utils/object.js';

import { authorize, validateAuthorizationIntegrity } from '../../../core/auth.js';
import { GeneralJws, SignatureInput } from '../../../jose/jws/general/types.js';
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
  dateModified?: string;
  published?: boolean;
  datePublished?: string;
  dataFormat: string;
};

export type LineageChildCollectionsWriteOptions = AuthCreateOptions & {
  lineageParent: CollectionsWrite,
  data?: Uint8Array;
  published?: boolean;
  dateModified? : string;
  datePublished? : string;
};

export class CollectionsWrite extends Message {
  readonly message: CollectionsWriteMessage; // a more specific type than the base type defined in parent class

  private constructor(message: CollectionsWriteMessage) {
    super(message);
  }

  public static async parse(message: CollectionsWriteMessage): Promise<CollectionsWrite> {
    await validateAuthorizationIntegrity(message, { allowedProperties: new Set(['recordId', 'contextId']) });

    const collectionsWrite = new CollectionsWrite(message);

    await collectionsWrite.validateIntegrity(); // CollectionsWrite specific data integrity check

    return collectionsWrite;
  }

  /**
   * Creates a CollectionsWrite message.
   * @param options.recordId If `undefined`, will be auto-filled as a originating message as convenience for developer.
   * @param options.lineageParent If `undefined`, it will be auto-filled with value of `options.recordId` as convenience for developer.
   * @param options.dateCreated If `undefined`, it will be auto-filled with current time.
   * @param options.dateModified If `undefined`, it will be auto-filled with current time.
   */
  public static async create(options: CollectionsWriteOptions): Promise<CollectionsWrite> {
    const currentTime = getCurrentTimeInHighPrecision();
    const dataCid = await getDagPbCid(options.data);
    const descriptor: CollectionsWriteDescriptor = {
      recipient     : options.recipient,
      method        : DwnMethodName.CollectionsWrite,
      protocol      : options.protocol,
      schema        : options.schema,
      lineageParent : options.lineageParent ?? options.recordId, // convenience for developer
      parentId      : options.parentId,
      dataCid       : dataCid.toString(),
      dateCreated   : options.dateCreated ?? currentTime,
      dateModified  : options.dateModified ?? currentTime,
      published     : options.published,
      datePublished : options.datePublished,
      dataFormat    : options.dataFormat
    };

    // generate `datePublished` if the message is to be published but `datePublished` is not given
    if (options.published === true &&
        options.datePublished === undefined) {
      descriptor.datePublished = getCurrentTimeInHighPrecision();
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

  /**
   * Convenience method that creates a lineage child message replacing the existing record state using the given lineage parent.
   * @param options.lineageParent Lineage parent that the new CollectionsWrite will be based from.
   * @param options.dateModified The new date the record is modified. If not given, current time will be used .
   * @param options.data The new data or the record. If not given, data from lineage parent will be used.
   * @param options.published The new published state. If not given, then will be set to `true` if {options.dateModified} is given;
   * else the state from lineage parent will be used.
   * @param options.publishedDate The new date the record is modified. If not given, then:
   * 1. will not be set if the record will be unpublished as the result of this CollectionsWrite; else
   * 2. will be set to the same published date as the lineage parent if it wss already published; else
   * 3. will be set to current time (because this is a toggle from unpublished to published)
   * @returns the CollectionsWrite that overwrites its lineage parent
   */
  public static async createLineageChild(options: LineageChildCollectionsWriteOptions): Promise<CollectionsWrite> {
    const parentMessage = options.lineageParent.message;
    const currentTime = getCurrentTimeInHighPrecision();

    // inherit published value from parent if neither published nor datePublished is specified
    const published = options.published ?? ( options.datePublished ? true : parentMessage.descriptor.published);
    // use current time if published but no explicit time given
    let datePublished = undefined;
    // if given explicitly published dated
    if (options.datePublished) {
      datePublished = options.datePublished;
    } else {
      // if this CollectionsWrite will publish the record
      if (published) {
        // the parent was already published, inherit the same published date
        if (parentMessage.descriptor.published) {
          datePublished = parentMessage.descriptor.datePublished;
        } else {
          // this is a toggle from unpublished to published, use current time
          datePublished = currentTime;
        }
      }
    }

    const createOptions: CollectionsWriteOptions = {
      // immutable properties below, just inherit from lineage parent
      target         : options.lineageParent.target,
      recipient      : parentMessage.descriptor.recipient,
      recordId       : parentMessage.recordId,
      dateCreated    : parentMessage.descriptor.dateCreated,
      contextId      : parentMessage.contextId,
      protocol       : parentMessage.descriptor.protocol,
      parentId       : parentMessage.descriptor.parentId,
      schema         : parentMessage.descriptor.schema,
      dataFormat     : parentMessage.descriptor.dataFormat,
      // mutable properties below, if not given, inherit from lineage parent
      lineageParent  : await options.lineageParent.getCanonicalId(),
      dateModified   : options.dateModified ?? currentTime,
      published,
      datePublished,
      data           : options.data ?? Encoder.base64UrlToBytes(parentMessage.encodedData), // there is opportunity for improvement here
      // finally still need input for signing
      signatureInput : options.signatureInput,
    };

    const collectionsWrite = await CollectionsWrite.create(createOptions);
    return collectionsWrite;
  }

  public async authorize(messageStore: MessageStore): Promise<void> {
    if (this.message.descriptor.protocol !== undefined) {
      await ProtocolAuthorization.authorize(this, this.author, messageStore);
    } else {
      await authorize(this);
    }
  }

  /**
   * Validates the integrity of the CollectionsWrite message assuming the message passed basic schema validation.
   * There is opportunity to integrate better with `validateSchema(...)`
   */
  private async validateIntegrity(): Promise<void> {
    // verify dataCid matches given data
    if (this.message.encodedData !== undefined) {
      const rawData = Encoder.base64UrlToBytes(this.message.encodedData);
      const actualDataCid = (await getDagPbCid(rawData)).toString();

      if (actualDataCid !== this.message.descriptor.dataCid) {
        throw new Error('actual CID of data and `dataCid` in descriptor mismatch');
      }
    }

    // make sure the same `recordId` in message is the same as the `recordId` in `authorization`
    if (this.message.recordId !== this.authorizationPayload.recordId) {
      throw new Error(
        `recordId in message ${this.message.recordId} does not match recordId in authorization: ${this.authorizationPayload.recordId}`
      );
    }

    // if the message is the lineage root
    if (this.message.descriptor.lineageParent === undefined) {
      // `dateModified` and `dateCreated` equality check
      const dateCreated = this.message.descriptor.dateCreated;
      const dateModified = this.message.descriptor.dateModified;
      if (dateModified !== dateCreated) {
        throw new Error(`dateModified ${dateModified} must match dateCreated ${dateCreated} for a lineage root write`);
      }

      // the `recordId` must match the expected deterministic value
      const expectedRecordId = await this.getCanonicalId();
      if (this.message.recordId !== expectedRecordId) {
        throw new Error(`recordId in message: ${this.message.recordId} does not match deterministic recordId: ${expectedRecordId}`);
      }

      // if the message is a protocol context root (AND it is a lineage root), the `contextId` must match the expected deterministic value
      if (this.message.descriptor.protocol !== undefined &&
          this.message.descriptor.parentId === undefined) {
        const expectedContextId = await this.getCanonicalId();

        if (this.message.contextId !== expectedContextId) {
          throw new Error(`contextId in message: ${this.message.contextId} does not match deterministic contextId: ${expectedContextId}`);
        }
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
   * Verifies that immutable properties of the two given messages are identical.
   * @throws {Error} if immutable properties between two CollectionsWrite message
   */
  public static verifyEqualityOfImmutableProperties(lineageRoot: CollectionsWriteMessage, newMessage: CollectionsWriteMessage): boolean {
    const mutableDescriptorProperties = ['dataCid', 'datePublished', 'published', 'lineageParent', 'dateModified'];

    // get distinct property names that exist in either lineage root or new message
    let descriptorPropertyNames = [];
    descriptorPropertyNames.push(...Object.keys(lineageRoot.descriptor));
    descriptorPropertyNames.push(...Object.keys(newMessage.descriptor));
    descriptorPropertyNames = [...new Set(descriptorPropertyNames)]; // step to remove duplicates

    // ensure all immutable properties are not modified
    for (const descriptorPropertyName of descriptorPropertyNames) {
      // if property is supposed to be immutable
      if (mutableDescriptorProperties.indexOf(descriptorPropertyName) === -1) {
        const valueInLineageRoot = lineageRoot.descriptor[descriptorPropertyName];
        const valueInNewMessage = newMessage.descriptor[descriptorPropertyName];
        if (valueInNewMessage !== valueInLineageRoot) {
          throw new Error(`${descriptorPropertyName} is an immutable property: cannot change '${valueInLineageRoot}' to '${valueInNewMessage}'`);
        }
      }
    }

    return true;
  }

  /**
   * Gets the lineage root message from the given list of messages.
   * @returns the lineage root in the given list of messages
   */
  public static getLineageRootMessage(messages: CollectionsWriteMessage[]): CollectionsWriteMessage {
    for (const message of messages) {
      // lineage root does not have lineage parent
      if (message.descriptor.lineageParent === undefined) {
        return message;
      }
    }

    throw new Error(`unable to find the lineage root of the given list of messages`);
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
    const aIsNewer = (await CollectionsWrite.compareModifiedTime(a, b) > 0);
    return aIsNewer;
  }

  /**
   * Checks if first message is older than second message.
   * @returns `true` if `a` is older than `b`; `false` otherwise
   */
  public static async isOlder(a: CollectionsWriteMessage, b: CollectionsWriteMessage): Promise<boolean> {
    const aIsNewer = (await CollectionsWrite.compareModifiedTime(a, b) < 0);
    return aIsNewer;
  }

  /**
   * Compares the `dateModified` of the given messages with a fallback to message CID according to the spec.
   * @returns 1 if `a` is larger/newer than `b`; -1 if `a` is smaller/older than `b`; 0 otherwise (same age)
   */
  public static async compareModifiedTime(a: CollectionsWriteMessage, b: CollectionsWriteMessage): Promise<number> {
    if (a.descriptor.dateModified > b.descriptor.dateModified) {
      return 1;
    } else if (a.descriptor.dateModified < b.descriptor.dateModified) {
      return -1;
    }

    // else `dateModified` is the same between a and b
    // compare the `dataCid` instead, the < and > operators compare strings in lexicographical order
    return Message.compareCid(a, b);
  }
}
