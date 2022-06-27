import { JsonMessage } from './messages/types';
import { validate } from './validation/validator';

type JsonRequest = {
  messages?: JsonMessage[]
  target: string
};

export class Request {
  messages: JsonMessage[];
  target: string;

  constructor(jsonRequest: JsonRequest) {
    this.target = jsonRequest.target;
    this.messages = jsonRequest.messages || [];
  }

  /**
   * unmarshals the provided payload into a Request.
   */
  static parse(rawRequest: any): Request {
    if (typeof rawRequest !== 'object') {
      try {
        rawRequest = JSON.parse(rawRequest);
      } catch(e) {
        throw new Error('expected request to be valid JSON');
      }
    }

    // throws an error if validation fails
    validate('Request', rawRequest);

    return new Request(rawRequest as JsonRequest);
  }

  addMessage(message: JsonMessage): void {
    this.messages.push(message);
  }
}