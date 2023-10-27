import type { GeneralJws } from '../types/jws-types.js';
import type { Signer } from '../types/signer.js';
import type { AuthorizationModel, Descriptor, GenericMessage, GenericSignaturePayload } from '../types/message-types.js';

import { Cid } from '../utils/cid.js';
import { Encoder } from '../index.js';
import { GeneralJwsBuilder } from '../jose/jws/general/builder.js';
import { Jws } from '../utils/jws.js';
import { lexicographicalCompare } from '../utils/string.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { validateJsonSchema } from '../schema-validator.js';

export enum DwnInterfaceName {
  Events = 'Events',
  Messages = 'Messages',
  Permissions = 'Permissions',
  Protocols = 'Protocols',
  Records = 'Records'
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
  readonly signerSignaturePayload: GenericSignaturePayload | undefined;
  readonly author: string | undefined;

  constructor(message: M) {
    this.message = message;

    if (message.authorization !== undefined) {
      this.signerSignaturePayload = Jws.decodePlainObjectPayload(message.authorization.authorSignature);
      this.author = Message.getSigner(message as GenericMessage);
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
   * Gets the DID of the signer of the given message, returns `undefined` if message is not signed.
   */
  public static getSigner(message: GenericMessage): string | undefined {
    if (message.authorization === undefined) {
      return undefined;
    }

    const signer = Jws.getSignerDid(message.authorization.authorSignature.signatures[0]);
    return signer;
  }

  /**
   * Gets the CID of the given message.
   */
  public static async getCid(message: GenericMessage): Promise<string> {
    // NOTE: we wrap the `computeCid()` here in case that
    // the message will contain properties that should not be part of the CID computation
    // and we need to strip them out (like `encodedData` that we historically had for a long time),
    // but we can remove this method entirely if the code becomes stable and it is apparent that the wrapper is not needed

    // ^--- seems like we might need to keep this around for now.
    const rawMessage = { ...message } as any;
    if (rawMessage.encodedData) {
      delete rawMessage.encodedData;
    }

    const cid = await Cid.computeCid(rawMessage as GenericMessage);
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
   * Creates the `authorization` as the author to be used in a DWN message.
   * @param signer Signer as the author
   * @returns {AuthorizationModel} used as an `authorization` property.
   */
  public static async createAuthorizationAsAuthor(
    descriptor: Descriptor,
    signer: Signer,
    additionalPayloadProperties?: { permissionsGrantId?: string, protocolRole?: string }
  ): Promise<AuthorizationModel> {
    const authorSignature = await Message.createSignature(descriptor, signer, additionalPayloadProperties);

    const authorization = { authorSignature };
    return authorization;
  }

  /**
   * Creates a generic signature from the given DWN message descriptor by including `descriptorCid` as the required property in the signature payload.
   * NOTE: there is an opportunity to consolidate RecordsWrite.createSignerSignature() wth this method
   */
  public static async createSignature(
    descriptor: Descriptor,
    signer: Signer,
    additionalPayloadProperties?: { permissionsGrantId?: string, protocolRole?: string }
  ): Promise<GeneralJws> {
    const descriptorCid = await Cid.computeCid(descriptor);

    const signaturePayload: GenericSignaturePayload = { descriptorCid, ...additionalPayloadProperties };
    removeUndefinedProperties(signaturePayload);

    const signaturePayloadBytes = Encoder.objectToBytes(signaturePayload);

    const builder = await GeneralJwsBuilder.create(signaturePayloadBytes, [signer]);
    const signature = builder.getJws();

    return signature;
  }

  /**
   * @returns newest message in the array. `undefined` if given array is empty.
   */
  public static async getNewestMessage(messages: GenericMessage[]): Promise<GenericMessage | undefined> {
    let currentNewestMessage: GenericMessage | undefined = undefined;
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
  public static async getOldestMessage(messages: GenericMessage[]): Promise<GenericMessage | undefined> {
    let currentOldestMessage: GenericMessage | undefined = undefined;
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
  public static async isNewer(a: GenericMessage, b: GenericMessage): Promise<boolean> {
    const aIsNewer = (await Message.compareMessageTimestamp(a, b) > 0);
    return aIsNewer;
  }

  /**
   * Checks if first message is older than second message.
   * @returns `true` if `a` is older than `b`; `false` otherwise
   */
  public static async isOlder(a: GenericMessage, b: GenericMessage): Promise<boolean> {
    const aIsOlder = (await Message.compareMessageTimestamp(a, b) < 0);
    return aIsOlder;
  }

  /**
   * Compares the `messageTimestamp` of the given messages with a fallback to message CID according to the spec.
   * @returns 1 if `a` is larger/newer than `b`; -1 if `a` is smaller/older than `b`; 0 otherwise (same age)
   */
  public static async compareMessageTimestamp(a: GenericMessage, b: GenericMessage): Promise<number> {
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