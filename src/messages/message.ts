import type { JsonMessage } from './types';

export abstract class Message<T extends JsonMessage> {
  constructor(protected message: T) {}

  static getJsonSchema(): object {
    throw new Error('method not implemented');
  }
  static getType(): string {
    throw new Error('method not implemented');
  };

  getMethod(): string {
    return this.message.descriptor.method;
  }

  toObject(): T {
    return this.message;
  }

  toJSON(): string {
    return JSON.stringify(this.message);
  }
}