import type { BaseMessage } from './types';

import lodash from 'lodash';
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
}