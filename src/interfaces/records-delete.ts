import type { DelegatedGrantMessage } from '../types/delegated-grant-message.js';
import type { Signer } from '../types/signer.js';
import type { RecordsDeleteDescriptor, RecordsDeleteMessage } from '../types/records-types.js';

import { AbstractMessage } from '../core/abstract-message.js';
import { Message } from '../core/message.js';
import { Records } from '../utils/records.js';
import { Time } from '../utils/time.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export type RecordsDeleteOptions = {
  recordId: string;
  messageTimestamp?: string;
  protocolRole?: string;
  signer: Signer;

  /**
   * The delegated grant to sign on behalf of the logical author, which is the grantor (`grantedBy`) of the delegated grant.
   */
  delegatedGrant?: DelegatedGrantMessage;
};

export class RecordsDelete extends AbstractMessage<RecordsDeleteMessage> {

  public static async parse(message: RecordsDeleteMessage): Promise<RecordsDelete> {
    let signaturePayload;
    if (message.authorization !== undefined) {
      signaturePayload = await Message.validateMessageSignatureIntegrity(message.authorization.signature, message.descriptor);
    }

    Records.validateDelegatedGrantReferentialIntegrity(message, signaturePayload);

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
      signer         : options.signer,
      protocolRole   : options.protocolRole,
      delegatedGrant : options.delegatedGrant
    });
    const message: RecordsDeleteMessage = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new RecordsDelete(message);
  }
}
