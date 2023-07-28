import type { GeneralJws } from '../types/jws-types.js';
import type { SignatureInput } from '../types/jws-types.js';
import type { BaseAuthorizationPayload, Descriptor, GenericMessage, TimestampedMessage } from '../types/message-types.js';

import { Cid } from '../utils/cid.js';
import { GeneralJwsSigner } from '../jose/jws/general/signer.js';
import { Jws } from '../utils/jws.js';
import { lexicographicalCompare } from '../utils/string.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { validateJsonSchema } from '../schema-validator.js';

export enum DwnInterfaceName {
  Events = 'Events',
  Hooks = 'Hooks',
  Messages = 'Messages',
  Permissions = 'Permissions',
  Protocols = 'Protocols',
  Records = 'Records',
  Snapshots = 'Snapshots'
}

export enum DwnMethodName {
  Configure = 'Configure',
  Create = 'Create',
  Get = 'Get',
  Grant = 'Grant',
  Query = 'Query',
  Read = 'Read',
  Request = 'Request',
  Revoke = 'Revoke',
  Write = 'Write',
  Delete = 'Delete'
}

export abstract class Message<M extends GenericMessage> {
  readonly message: M;
  readonly authorizationPayload: BaseAuthorizationPayload | undefined;
  readonly author: string | undefined;

  constructor(message: M) {
    this.message = message;

    if (message.authorization !== undefined) {
      this.authorizationPayload = Jws.decodePlainObjectPayload(message.authorization);
      this.author = Message.getAuthor(message as GenericMessage);
    }
  }

  /**
   * Called by `JSON.stringify(...)` automatically.
   */
  toJSON(): GenericMessage {
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
  public static getAuthor(message: GenericMessage): string | undefined {
    if (message.authorization === undefined) {
      return undefined;
    }

    const author = Jws.getSignerDid(message.authorization.signatures[0]);
    return author;
  }

  /**
   * Gets the CID of the given message.
   */
  public static async getCid(message: GenericMessage): Promise<string> {
    // NOTE: we wrap the `computeCid()` here in case that
    // the message will contain properties that should not be part of the CID computation
    // and we need to strip them out (like `encodedData` that we historically had for a long time),
    // but we can remove this method entirely if the code becomes stable and it is apparent that the wrapper is not needed
    const cid = await Cid.computeCid(message);
    return cid;
  }

  /**
   * Compares message CID in lexicographical order according to the spec.
   * @returns 1 if `a` is larger than `b`; -1 if `a` is smaller/older than `b`; 0 otherwise (same message)
   */
  public static async compareCid(a: GenericMessage, b: GenericMessage): Promise<number> {
    // the < and > operators compare strings in lexicographical order
    const cidA = await Message.getCid(a);
    const cidB = await Message.getCid(b);
    return lexicographicalCompare(cidA, cidB);
  }

  /**
   * Compares the CID of two messages.
   * @returns `true` if `a` is newer than `b`; `false` otherwise
   */
  public static async isCidLarger(a: GenericMessage, b: GenericMessage): Promise<boolean> {
    const aIsLarger = (await Message.compareCid(a, b) > 0);
    return aIsLarger;
  }

  /**
   * @returns message with the largest CID in the array using lexicographical compare. `undefined` if given array is empty.
   */
  public static async getMessageWithLargestCid(messages: GenericMessage[]): Promise<GenericMessage | undefined> {
    let currentNewestMessage: GenericMessage | undefined = undefined;
    for (const message of messages) {
      if (currentNewestMessage === undefined || await Message.isCidLarger(message, currentNewestMessage)) {
        currentNewestMessage = message;
      }
    }

    return currentNewestMessage;
  }

  /**
   * Signs over the CID of provided `descriptor`. The output is used as an `authorization` property.
   * @param signatureInput - the signature material to use (e.g. key and header data)
   * @returns General JWS signature used as an `authorization` property.
   */
  public static async signAsAuthorization(
    descriptor: Descriptor,
    signatureInput: SignatureInput,
    permissionsGrantId?: string,
  ): Promise<GeneralJws> {
    const descriptorCid = await Cid.computeCid(descriptor);

    const authPayload: BaseAuthorizationPayload = { descriptorCid, permissionsGrantId };
    removeUndefinedProperties(authPayload);
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
   * @returns oldest message in the array. `undefined` if given array is empty.
   */
  public static async getOldestMessage(messages: TimestampedMessage[]): Promise<TimestampedMessage | undefined> {
    let currentOldestMessage: TimestampedMessage | undefined = undefined;
    for (const message of messages) {
      if (currentOldestMessage === undefined || await Message.isOlder(message, currentOldestMessage)) {
        currentOldestMessage = message;
      }
    }

    return currentOldestMessage;
  }

  /**
   * Checks if first message is newer than second message.
   * @returns `true` if `a` is newer than `b`; `false` otherwise
   */
  public static async isNewer(a: TimestampedMessage, b: TimestampedMessage): Promise<boolean> {
    const aIsNewer = (await Message.compareMessageTimestamp(a, b) > 0);
    return aIsNewer;
  }

  /**
   * Checks if first message is older than second message.
   * @returns `true` if `a` is older than `b`; `false` otherwise
   */
  public static async isOlder(a: TimestampedMessage, b: TimestampedMessage): Promise<boolean> {
    const aIsOlder = (await Message.compareMessageTimestamp(a, b) < 0);
    return aIsOlder;
  }

  /**
   * Compares the `messageTimestamp` of the given messages with a fallback to message CID according to the spec.
   * @returns 1 if `a` is larger/newer than `b`; -1 if `a` is smaller/older than `b`; 0 otherwise (same age)
   */
  public static async compareMessageTimestamp(a: TimestampedMessage, b: TimestampedMessage): Promise<number> {
    if (a.descriptor.messageTimestamp > b.descriptor.messageTimestamp) {
      return 1;
    } else if (a.descriptor.messageTimestamp < b.descriptor.messageTimestamp) {
      return -1;
    }

    // else `messageTimestamp` is the same between a and b
    // compare the `dataCid` instead, the < and > operators compare strings in lexicographical order
    return Message.compareCid(a, b);
  }
}