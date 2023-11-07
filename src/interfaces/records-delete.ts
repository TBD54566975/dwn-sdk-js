import type { Signer } from '../types/signer.js';
import type { RecordsDeleteDescriptor, RecordsDeleteMessage } from '../types/records-types.js';

import { Message } from '../core/message.js';

import { Time } from '../utils/time.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export type RecordsDeleteOptions = {
  recordId: string;
  messageTimestamp?: string;
  protocolRole?: string;
  signer: Signer;
};

export class RecordsDelete extends Message<RecordsDeleteMessage> {

  public static async parse(message: RecordsDeleteMessage): Promise<RecordsDelete> {
    await Message.validateMessageSignatureIntegrity(message.authorization.signature, message.descriptor);
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
}
