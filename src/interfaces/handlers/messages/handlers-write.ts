import { sign } from '../../../core/auth';
import type { AuthCreateOptions } from '../../../core/types';
import type { HandlersWriteDescriptor, HandlersWriteMessage } from '../../handlers/types';
import { removeUndefinedProperties } from '../../../utils/object';
import { validate } from '../../../validation/validator';

/**
 * Input to `HandlersWrite.create()`.
 */
export type HandlersWriteOptions = AuthCreateOptions & {
  target: string,
  /**
   * leave as `undefined` for customer handler.
   * ie. DWN processing will use `undefined` check to attempt to invoke the registered handler.
   */
  uri?: string,
  filter: {
    method: string,
  }
};

/**
 * Class that provides `HandlersWrite` related operations.
 */
export class HandlersWrite {
  /**
   * Creates a HandlersWrite message
   */
  static async create(options: HandlersWriteOptions): Promise<HandlersWriteMessage> {
    const descriptor: HandlersWriteDescriptor = {
      target : options.target,
      method : 'HandlersWrite',
      uri    : options.uri,
      filter : options.filter
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    const messageType = descriptor.method;
    validate(messageType, { descriptor, authorization: {} });

    const authorization = await sign({ descriptor }, options.signatureInput);
    const message = { descriptor, authorization };

    return message;
  }
}
