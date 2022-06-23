import type { JsonDataMessage } from './types';

import { Message } from './message';

export abstract class DataMessage extends Message {
  constructor(message: JsonDataMessage) {
    super(message);
  }
}