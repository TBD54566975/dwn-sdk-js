import { MessageJson } from './messages/types';
import { validate } from './validation/validator';

type RequestJson = {
  messages?: MessageJson[]
  target: string
};

export class Request {
  messages: MessageJson[];
  target: string;

  constructor(jsonRequest: RequestJson) {
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

    return new Request(rawRequest as RequestJson);
  }

  addMessage(message: MessageJson): void {
    this.messages.push(message);
  }
}