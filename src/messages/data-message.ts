import type { JsonDataMessage } from './types';

import { Data } from './data';
import { Message } from './message';

export abstract class DataMessage extends Message {
  protected message: JsonDataMessage;
  data: Data;

  constructor(message: JsonDataMessage) {
    super(message);

    this.message = message;
    this.data = new Data(this.message.data);
  }
}