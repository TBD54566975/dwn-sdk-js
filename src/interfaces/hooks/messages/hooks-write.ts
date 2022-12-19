import type { AuthCreateOptions } from '../../../core/types.js';
import type { HooksWriteDescriptor, HooksWriteMessage } from '../../hooks/types.js';

import { getCurrentTimeInHighPrecision } from '../../../utils/time.js';
import { removeUndefinedProperties } from '../../../utils/object.js';

import { DwnMethodName, Message } from '../../../core/message.js';

/**
 * Input to `HookssWrite.create()`.
 */
export type HooksWriteOptions = AuthCreateOptions & {
  target: string,
  dateCreated?: string,
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
export class HooksWrite extends Message {
  readonly message: HooksWriteMessage; // a more specific type than the base type defined in parent class

  constructor(message: HooksWriteMessage) {
    super(message);
  }

  /**
   * Creates a HooksWrite message
   */
  static async create(options: HooksWriteOptions): Promise<HooksWrite> {
    const descriptor: HooksWriteDescriptor = {
      method      : DwnMethodName.HooksWrite,
      dateCreated : options.dateCreated ?? getCurrentTimeInHighPrecision(),
      uri         : options.uri,
      filter      : options.filter
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    Message.validateJsonSchema({ descriptor, authorization: { } });

    const authorization = await Message.signAsAuthorization(options.target, descriptor, options.signatureInput);
    const message = { descriptor, authorization };

    const hooksWrite = new HooksWrite(message);
    return hooksWrite;
  }
}
