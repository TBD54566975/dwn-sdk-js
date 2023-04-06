import type { SignatureInput } from '../jose/jws/general/types.js';
import type { BaseDecodedAuthorizationPayload, BaseMessage, Descriptor, TimestampedMessage } from './types.js';

import { computeCid } from '../utils/cid.js';
import type { GeneralJws } from '../jose/jws/general/types.js';
import { GeneralJwsSigner } from '../jose/jws/general/signer.js';
import { Jws } from '../utils/jws.js';
import { lexicographicalCompare } from '../utils/string.js';
import { validateJsonSchema } from '../schema-validator.js';

export enum DwnInterfaceName {
  Hooks = 'Hooks',
  Permissions = 'Permissions',
  Protocols = 'Protocols',
  Records = 'Records'
}

export enum DwnMethodName {
  Configure = 'Configure',
  Grant = 'Grant',
  Query = 'Query',
  Read = 'Read',
  Request = 'Request',
  Write = 'Write',
  Delete = 'Delete'
}

export abstract class Message<M extends BaseMessage> {
  readonly message: M;
  readonly authorizationPayload: any;

  // commonly used properties for extra convenience;
  readonly author: string | undefined;

  constructor(message: M) {
    this.message = message;

    if (message.authorization !== undefined) {
      this.authorizationPayload = Jws.decodePlainObjectPayload(message.authorization);
      this.author = Message.getAuthor(message as BaseMessage);
    }
  }

  /**
   * Called by `JSON.stringify(...)` automatically.
   */
  toJSON(): BaseMessage {
    return this.message;
  }

  /**
   * Validates the given message against the corresponding JSON schema.
   * @throws {Error} if fails validation.
   */
  public static validateJsonSchema(rawMessage: any): void {
    const dwnInterface = rawMessage.descriptor.interface;
    const dwnMethod = rawMessage.descriptor.method;
    const schemaLookupKey = dwnInterface + dwnMethod;

    // throws an error if message is invalid
    validateJsonSchema(schemaLookupKey, rawMessage);
  };

  /**
   * Gets the DID of the author of the given message, returned `undefined` if message is not signed.
   */
  public static getAuthor(message: BaseMessage): string | undefined {
    if (message.authorization === undefined) {
      return undefined;
    }

    const author = Jws.getSignerDid(message.authorization.signatures[0]);
    return author;
  }

  /**
   * Gets the CID of the given message.
   */
  public static async getCid(message: BaseMessage): Promise<string> {
    // NOTE: we wrap the `computeCid()` here in case that
    // the message will contain properties that should not be part of the CID computation
    // and we need to strip them out (like `encodedData` that we historically had for a long time),
    // but we can remove this method entirely if the code becomes stable and it is apparent that the wrapper is not needed
    const cid = await computeCid(message);
    return cid;
  }

  /**
   * Compares message CID in lexicographical order according to the spec.
   * @returns 1 if `a` is larger than `b`; -1 if `a` is smaller/older than `b`; 0 otherwise (same message)
   */
  public static async compareCid(a: BaseMessage, b: BaseMessage): Promise<number> {
    // the < and > operators compare strings in lexicographical order
    const cidA = await Message.getCid(a);
    const cidB = await Message.getCid(b);
    return lexicographicalCompare(cidA, cidB);
  }

  /**
   * Compares the CID of two messages.
   * @returns `true` if `a` is newer than `b`; `false` otherwise
   */
  public static async isCidLarger(a: BaseMessage, b: BaseMessage): Promise<boolean> {
    const aIsLarger = (await Message.compareCid(a, b) > 0);
    return aIsLarger;
  }

  /**
   * @returns message with the largest CID in the array using lexicographical compare. `undefined` if given array is empty.
   */
  public static async getMessageWithLargestCid(messages: BaseMessage[]): Promise<BaseMessage | undefined> {
    let currentNewestMessage: BaseMessage | undefined = undefined;
    for (const message of messages) {
      if (currentNewestMessage === undefined || await Message.isCidLarger(message, currentNewestMessage)) {
        currentNewestMessage = message;
      }
    }

    return currentNewestMessage;
  }

  /**
   * Signs the provided message to be used an `authorization` property. Signed payload includes the CID of the message's descriptor by default
   * along with any additional payload properties provided
   * @param descriptor - the message to sign
   * @param signatureInput - the signature material to use (e.g. key and header data)
   * @returns General JWS signature used as an `authorization` property.
   */
  public static async signAsAuthorization(
    descriptor: Descriptor,
    signatureInput: SignatureInput
  ): Promise<GeneralJws> {
    const descriptorCid = await computeCid(descriptor);

    const authPayload: BaseDecodedAuthorizationPayload = { descriptorCid };
    const authPayloadStr = JSON.stringify(authPayload);
    const authPayloadBytes = new TextEncoder().encode(authPayloadStr);

    const signer = await GeneralJwsSigner.create(authPayloadBytes, [signatureInput]);

    return signer.getJws();
  }


  /**
   * @returns newest message in the array. `undefined` if given array is empty.
   */
  public static async getNewestMessage(messages: TimestampedMessage[]): Promise<TimestampedMessage | undefined> {
    let currentNewestMessage: TimestampedMessage | undefined = undefined;
    for (const message of messages) {
      if (currentNewestMessage === undefined || await Message.isNewer(message, currentNewestMessage)) {
        currentNewestMessage = message;
      }
    }

    return currentNewestMessage;
  }

  /**
   * Checks if first message is newer than second message.
   * @returns `true` if `a` is newer than `b`; `false` otherwise
   */
  public static async isNewer(a: TimestampedMessage, b: TimestampedMessage): Promise<boolean> {
    const aIsNewer = (await Message.compareModifiedTime(a, b) > 0);
    return aIsNewer;
  }

  /**
   * Checks if first message is older than second message.
   * @returns `true` if `a` is older than `b`; `false` otherwise
   */
  public static async isOlder(a: TimestampedMessage, b: TimestampedMessage): Promise<boolean> {
    const aIsNewer = (await Message.compareModifiedTime(a, b) < 0);
    return aIsNewer;
  }

  /**
   * Compares the `dateModified` of the given messages with a fallback to message CID according to the spec.
   * @returns 1 if `a` is larger/newer than `b`; -1 if `a` is smaller/older than `b`; 0 otherwise (same age)
   */
  public static async compareModifiedTime(a: TimestampedMessage, b: TimestampedMessage): Promise<number> {
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