import type { JsonDataMessage } from './types';

import { Message } from './message';

export abstract class DataMessage<T extends JsonDataMessage> extends Message<T> {
  constructor(message: T) {
    super(message);
  }

  toObject(): T {
    return this.message;
  }

  toJSON(): string {
    return JSON.stringify(this.message);
  }
}