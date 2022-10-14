import type { AuthCreateOptions } from '../../../core/types';
import type { HooksWriteDescriptor, HooksWriteMessage } from '../../hooks/types';
import { Jws } from '../../../jose/jws/jws';
import { removeUndefinedProperties } from '../../../utils/object';
import { validate } from '../../../validation/validator';

/**
 * Input to `HookssWrite.create()`.
 */
export type HooksWriteOptions = AuthCreateOptions & {
  target: string,
  dateCreated?: number,
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
 * Class that provides `HooksWrite` related operations.
 */
export class HooksWrite {
  /**
   * Creates a HooksWrite message
   */
  static async create(options: HooksWriteOptions): Promise<HooksWriteMessage> {
    const descriptor: HooksWriteDescriptor = {
      target      : options.target,
      method      : 'HooksWrite',
      dateCreated : options.dateCreated ?? Date.now(),
      uri         : options.uri,
      filter      : options.filter
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    const messageType = descriptor.method;
    validate(messageType, { descriptor, authorization: {} });

    const authorization = await Jws.sign({ descriptor }, options.signatureInput);
    const message = { descriptor, authorization };

    return message;
  }
}
