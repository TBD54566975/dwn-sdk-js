import type { MessageJson } from './types';

import lodash from 'lodash';
import { validate } from '../validation/validator';

const { cloneDeep, isPlainObject } = lodash;
export abstract class Message {
  constructor(protected message: MessageJson) {}

  static getJsonSchema(): object {
    throw new Error('method not implemented');
  }
  static getType(): string {
    throw new Error('method not implemented');
  };

  static unmarshal(rawMessage: object): MessageJson {
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

    return rawMessage as MessageJson;
  };

  getMethod(): string {
    return this.message.descriptor.method;
  }

  toObject(): MessageJson {
    return cloneDeep(this.message);
  }

  toJSON(): string {
    return JSON.stringify(this.message);
  }
}