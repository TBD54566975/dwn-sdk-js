import type { BaseMessage } from '../../../core/types.js';
import type { SignatureInput } from '../../../jose/jws/general/types.js';
import type { RecordsReadDescriptor, RecordsReadMessage } from '../types.js';

import { getCurrentTimeInHighPrecision } from '../../../utils/time.js';
import { Message } from '../../../core/message.js';
import { validateAuthorizationIntegrity } from '../../../core/auth.js';
import { DwnInterfaceName, DwnMethodName } from '../../../core/message.js';

export type RecordsReadOptions = {
  recordId: string;
  date?: string;
  authorizationSignatureInput?: SignatureInput;
};

export class RecordsRead extends Message<RecordsReadMessage> {

  public static async parse(message: RecordsReadMessage): Promise<RecordsRead> {
    if (message.authorization !== undefined) {
      await validateAuthorizationIntegrity(message as BaseMessage);
    }

    const recordsRead = new RecordsRead(message);
    return recordsRead;
  }

  /**
   * Creates a RecordsRead message.
   * @param options.recordId If `undefined`, will be auto-filled as a originating message as convenience for developer.
   * @param options.date If `undefined`, it will be auto-filled with current time.
   */
  public static async create(options: RecordsReadOptions): Promise<RecordsRead> {
    const { recordId, authorizationSignatureInput } = options;
    const currentTime = getCurrentTimeInHighPrecision();

    const descriptor: RecordsReadDescriptor = {
      interface : DwnInterfaceName.Records,
      method    : DwnMethodName.Read,
      recordId,
      date      : options.date ?? currentTime
    };

    // only generate the `authorization` property if signature input is given
    const authorization = authorizationSignatureInput ? await Message.signAsAuthorization(descriptor, authorizationSignatureInput) : undefined;
    const message: RecordsReadMessage = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new RecordsRead(message);
  }

  public async authorize(tenant: string): Promise<void> {
    // if author/requester is the same as the target tenant, we can directly grant access
    if (this.author === tenant) {
      return;
    } else {
      throw new Error('message failed authorization');
    }
  }
}
