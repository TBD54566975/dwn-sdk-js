import type { BaseMessage, Descriptor } from './types';
import type { SignatureInput } from '../jose/jws/general/types';

import { CID } from 'multiformats/cid';
import { CollectionsWriteMessage } from '../interfaces/collections/types';
import { compareCids, generateCid } from '../utils/cid';
import { GeneralJws } from '../jose/jws/general/types';
import { GeneralJwsSigner, GeneralJwsVerifier } from '../jose/jws/general';
import { validate } from '../validator';

export enum DwnMethodName {
  CollectionsWrite = 'CollectionsWrite',
  CollectionsQuery = 'CollectionsQuery',
  HooksWrite = 'HooksWrite',
  ProtocolsConfigure = 'ProtocolsConfigure',
  ProtocolsQuery = 'ProtocolsQuery'
}

export abstract class Message {
  readonly author: string;
  readonly message: BaseMessage;

  constructor(message: BaseMessage) {
    this.author = GeneralJwsVerifier.getDid(message.authorization.signatures[0]);
    this.message = message;
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
    validate(rawMessage.descriptor.method, rawMessage);

    return rawMessage as BaseMessage;
  };

  /**
   * Gets the CID of the given message.
   * NOTE: `encodedData` is ignored when computing the CID of message.
   */
  public static async getCid(message: BaseMessage): Promise<CID> {
    const messageCopy = { ...message };

    if (messageCopy['encodedData'] !== undefined) {
      delete (messageCopy as CollectionsWriteMessage).encodedData;
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
    return compareCids(cidA, cidB);
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
    const descriptorCid = await generateCid(descriptor);

    const authPayload = { descriptorCid: descriptorCid.toString() };
    const authPayloadStr = JSON.stringify(authPayload);
    const authPayloadBytes = new TextEncoder().encode(authPayloadStr);

    const signer = await GeneralJwsSigner.create(authPayloadBytes, [signatureInput]);

    return signer.getJws();
  }
}