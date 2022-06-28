import type { DataMessageJson } from './types';

import { Data } from './data';
import { Message } from './message';

export abstract class DataMessage extends Message {
  protected message: DataMessageJson;
  data: Data;

  constructor(message: DataMessageJson) {
    super(message);

    this.message = message;
    this.data = new Data(this.message.data);
  }
}