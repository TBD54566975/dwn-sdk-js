import type { MessageSchema } from './types';

import lodash from 'lodash';
import { validate } from '../validation/validator';

const { cloneDeep, isPlainObject } = lodash;
export abstract class Message {
  constructor(protected message: MessageSchema) {}

  static parse(rawMessage: object): MessageSchema {
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

    return rawMessage as MessageSchema;
  };

  getMethod(): string {
    return this.message.descriptor.method;
  }

  toObject(): MessageSchema {
    return cloneDeep(this.message);
  }

  toJSON(): MessageSchema {
    return this.message;
  }
}