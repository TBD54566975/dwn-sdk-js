import { RequestSchema } from './types.js';
import { validateJsonSchema } from '../validator.js';

export class Request {
  /**
   * parses the provided payload into a `RequestSchema`.
   */
  static parse(request: object): RequestSchema {
    // throws an error if validation fails
    validateJsonSchema('Request', request);

    return request as RequestSchema;
  }
}