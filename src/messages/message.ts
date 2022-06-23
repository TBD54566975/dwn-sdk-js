import type { JsonMessage } from './types';

import { isPlainObject } from 'lodash';
import { validate } from '../validation/validator';
export abstract class Message {
  constructor(protected message: JsonMessage) {}

  static getJsonSchema(): object {
    throw new Error('method not implemented');
  }
  static getType(): string {
    throw new Error('method not implemented');
  };

  static unmarshal(rawMessage: object): JsonMessage {
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

    return rawMessage as JsonMessage;
  };

  getMethod(): string {
    return this.message.descriptor.method;
  }

  toObject(): JsonMessage {
    return this.message;
  }

  toJSON(): string {
    return JSON.stringify(this.message);
  }
}