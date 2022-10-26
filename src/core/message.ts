import type { BaseMessage } from './types';

import lodash from 'lodash';
import { CID } from 'multiformats/cid';
import { CollectionsWriteMessage } from '../interfaces/collections/types';
import { compareCids, generateCid } from '../utils/cid';
import { validate } from '../validation/validator';

const { cloneDeep, isPlainObject } = lodash;
export abstract class Message {
  constructor(protected message: BaseMessage) {}

  static parse(rawMessage: object): BaseMessage {
    const descriptor = rawMessage['descriptor'];
    if (!descriptor) {
      throw new Error('message must contain descriptor');
    }

    if (!isPlainObject(descriptor)) {
      throw new Error('descriptor: must be object');
    }

    const messageType = descriptor['method'];
    if (!messageType) {
      throw new Error('descriptor must contain method');
    }

    // validate throws an error if message is invalid
    validate(messageType, rawMessage);

    return rawMessage as BaseMessage;
  };

  getMethod(): string {
    return this.message.descriptor.method;
  }

  toObject(): BaseMessage {
    return cloneDeep(this.message);
  }

  toJSON(): BaseMessage {
    return this.message;
  }

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
}