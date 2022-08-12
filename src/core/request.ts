import { RequestSchema } from './types';
import { validate } from '../validation/validator';

export class Request {
  /**
   * parses the provided payload into a Request.
   */
  static parse(rawRequest: any): RequestSchema {
    if (typeof rawRequest !== 'object') {
      try {
        rawRequest = JSON.parse(rawRequest);
      } catch {
        throw new Error('expected request to be valid JSON');
      }
    }

    // throws an error if validation fails
    validate('Request', rawRequest);

    return rawRequest as RequestSchema;
  }
}