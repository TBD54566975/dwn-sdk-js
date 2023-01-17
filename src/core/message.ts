import type { SignatureInput } from '../jose/jws/general/types.js';
import type { BaseDecodedAuthorizationPayload, BaseMessage, Descriptor } from './types.js';

import { CID } from 'multiformats/cid';
import { GeneralJws } from '../jose/jws/general/types.js';
import { GeneralJwsSigner } from '../jose/jws/general/signer.js';
import { GeneralJwsVerifier } from '../jose/jws/general/verifier.js';
import { generateCid } from '../utils/cid.js';
import { lexicographicalCompare } from '../utils/string.js';
import { RecordsWriteMessage } from '../interfaces/records/types.js';
import { validateJsonSchema } from '../validator.js';

export enum DwnMethodName {
  RecordsWrite = 'RecordsWrite',
  RecordsQuery = 'RecordsQuery',
  HooksWrite = 'HooksWrite',
  ProtocolsConfigure = 'ProtocolsConfigure',
  ProtocolsQuery = 'ProtocolsQuery'
}

export abstract class Message {
  readonly message: BaseMessage;
  readonly authorizationPayload: any;

  // commonly used properties for extra convenience;
  readonly author: string;
  readonly target: string;

  constructor(message: BaseMessage) {
    this.message = message;
    this.authorizationPayload = GeneralJwsVerifier.decodePlainObjectPayload(message.authorization);

    this.author = Message.getAuthor(message);
    this.target = this.authorizationPayload.target;
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
  public static validateJsonSchema(rawMessage: any): BaseMessage {
    // validate throws an error if message is invalid
    validateJsonSchema(rawMessage.descriptor.method, rawMessage);

    return rawMessage as BaseMessage;
  };

  /**
   * Gets the DID of the author of the given message.
   */
  public static getAuthor(message: BaseMessage): string {
    const author = GeneralJwsVerifier.getDid(message.authorization.signatures[0]);
    return author;
  }

  /**
   * Gets the CID of the given message.
   * NOTE: `encodedData` is ignored when computing the CID of message.
   */
  public static async getCid(message: BaseMessage): Promise<CID> {
    const messageCopy = { ...message };

    if (messageCopy['encodedData'] !== undefined) {
      delete (messageCopy as RecordsWriteMessage).encodedData;
    }

    const cid = await generateCid(messageCopy);
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
   * @param target - the logical DID where this message will be sent to
   * @param descriptor - the message to sign
   * @param signatureInput - the signature material to use (e.g. key and header data)
   * @returns General JWS signature used as an `authorization` property.
   */
  public static async signAsAuthorization(
    target: string,
    descriptor: Descriptor,
    signatureInput: SignatureInput
  ): Promise<GeneralJws> {
    const descriptorCid = await generateCid(descriptor);

    const authPayload: BaseDecodedAuthorizationPayload = { target, descriptorCid: descriptorCid.toString() };
    const authPayloadStr = JSON.stringify(authPayload);
    const authPayloadBytes = new TextEncoder().encode(authPayloadStr);

    const signer = await GeneralJwsSigner.create(authPayloadBytes, [signatureInput]);

    return signer.getJws();
  }
}