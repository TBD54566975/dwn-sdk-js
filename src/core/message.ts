import type { BaseMessageSchema } from './types';

import lodash from 'lodash';
import { validate } from '../validation/validator';

const { cloneDeep, isPlainObject } = lodash;
export abstract class Message {
  constructor(protected message: BaseMessageSchema) {}

  static parse(rawMessage: object): BaseMessageSchema {
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

    return rawMessage as BaseMessageSchema;
  };

  getMethod(): string {
    return this.message.descriptor.method;
  }

  toObject(): BaseMessageSchema {
    return cloneDeep(this.message);
  }

  toJSON(): BaseMessageSchema {
    return this.message;
  }
}