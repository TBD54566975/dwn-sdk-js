import { BaseMessageSchema } from './types';
import { validate } from '../validation/validator';

type RequestJson = {
  messages?: BaseMessageSchema[]
  target: string
};

export class Request {
  messages: BaseMessageSchema[];
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
      } catch {
        throw new Error('expected request to be valid JSON');
      }
    }

    // throws an error if validation fails
    validate('Request', rawRequest);

    return new Request(rawRequest as RequestJson);
  }

  addMessage(message: BaseMessageSchema): void {
    this.messages.push(message);
  }
}