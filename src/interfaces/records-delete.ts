import type { MessageStore } from '../index.js';
import type { RecordsWrite } from './records-write.js';
import type { Signer } from '../types/signer.js';
import type { RecordsDeleteDescriptor, RecordsDeleteMessage } from '../types/records-types.js';

import { Message } from '../core/message.js';

import { ProtocolAuthorization } from '../core/protocol-authorization.js';
import { Time } from '../utils/time.js';
import { validateMessageSignatureIntegrity } from '../core/auth.js';
import { DwnError, DwnErrorCode } from '../index.js';
import { DwnInterfaceName, DwnMethodName } from '../core/message.js';

export type RecordsDeleteOptions = {
  recordId: string;
  messageTimestamp?: string;
  protocolRole?: string;
  signer: Signer;
};

export class RecordsDelete extends Message<RecordsDeleteMessage> {

  public static async parse(message: RecordsDeleteMessage): Promise<RecordsDelete> {
    await validateMessageSignatureIntegrity(message.authorization.signature, message.descriptor);
    Time.validateTimestamp(message.descriptor.messageTimestamp);

    const recordsDelete = new RecordsDelete(message);
    return recordsDelete;
  }

  /**
   * Creates a RecordsDelete message.
   * @param options.recordId If `undefined`, will be auto-filled as a originating message as convenience for developer.
   * @param options.messageTimestamp If `undefined`, it will be auto-filled with current time.
   */
  public static async create(options: RecordsDeleteOptions): Promise<RecordsDelete> {
    const recordId = options.recordId;
    const currentTime = Time.getCurrentTimestamp();

    const descriptor: RecordsDeleteDescriptor = {
      interface        : DwnInterfaceName.Records,
      method           : DwnMethodName.Delete,
      recordId,
      messageTimestamp : options.messageTimestamp ?? currentTime
    };

    const authorization = await Message.createAuthorization({
      descriptor,
      signer       : options.signer,
      protocolRole : options.protocolRole,
    });
    const message: RecordsDeleteMessage = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new RecordsDelete(message);
  }

  public async authorize(tenant: string, newestRecordsWrite: RecordsWrite, messageStore: MessageStore): Promise<void> {
    if (this.author === tenant) {
      return;
    } else if (newestRecordsWrite.message.descriptor.protocol !== undefined) {
      await ProtocolAuthorization.authorizeDelete(tenant, this, newestRecordsWrite, messageStore);
    } else {
      throw new DwnError(
        DwnErrorCode.RecordsDeleteAuthorizationFailed,
        'RecordsDelete message failed authorization'
      );
    }
  }
}
