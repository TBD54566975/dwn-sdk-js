import type { MessageStore } from '../types/message-store.js';
import type { RecordsWrite } from './records-write.js';
import type { Signer } from '../types/signer.js';
import type { RecordsFilter , RecordsReadDescriptor, RecordsReadMessage } from '../types/records-types.js';

import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { Message } from '../core/message.js';
import { ProtocolAuthorization } from '../core/protocol-authorization.js';
import { Records } from '../utils/records.js';
import { RecordsGrantAuthorization } from '../core/records-grant-authorization.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { validateMessageSignatureIntegrity } from '../core/auth.js';
import { DwnInterfaceName, DwnMethodName } from '../core/message.js';

export type RecordsReadOptions = {
  filter: RecordsFilter;
  date?: string;
  authorizationSigner?: Signer;
  permissionsGrantId?: string;
  /**
   * Used when authorizing protocol records.
   * The protocol path to a $globalRole record whose recipient is the author of this RecordsRead
   */
  protocolRole?: string;
};

export class RecordsRead extends Message<RecordsReadMessage> {

  public static async parse(message: RecordsReadMessage): Promise<RecordsRead> {
    if (message.authorization !== undefined) {
      await validateMessageSignatureIntegrity(message.authorization.authorSignature, message.descriptor);
    }

    const recordsRead = new RecordsRead(message);
    return recordsRead;
  }

  /**
   * Creates a RecordsRead message.
   * @param options.recordId If `undefined`, will be auto-filled as a originating message as convenience for developer.
   * @param options.date If `undefined`, it will be auto-filled with current time.
   *
   * @throws {DwnError} when a combination of required RecordsReadOptions are missing
   */
  public static async create(options: RecordsReadOptions): Promise<RecordsRead> {
    const { filter, authorizationSigner, permissionsGrantId, protocolRole } = options;
    const currentTime = getCurrentTimeInHighPrecision();

    const descriptor: RecordsReadDescriptor = {
      interface        : DwnInterfaceName.Records,
      method           : DwnMethodName.Read,
      filter           : Records.normalizeFilter(filter),
      messageTimestamp : options.date ?? currentTime,
    };

    removeUndefinedProperties(descriptor);

    // only generate the `authorization` property if signature input is given
    let authorization = undefined;
    if (authorizationSigner !== undefined) {
      authorization = await Message.createAuthorizationAsAuthor(descriptor, authorizationSigner, { permissionsGrantId, protocolRole });
    }
    const message: RecordsReadMessage = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new RecordsRead(message);
  }

  public async authorize(tenant: string, newestRecordsWrite: RecordsWrite, messageStore: MessageStore): Promise<void> {
    const { descriptor } = newestRecordsWrite.message;

    // if author is the same as the target tenant, we can directly grant access
    if (this.author === tenant) {
      return;
    } else if (descriptor.published === true) {
      // authentication is not required for published data
      return;
    } else if (this.author !== undefined && this.author === descriptor.recipient) {
      // The recipient of a message may always read it
      return;
    } else if (descriptor.protocol !== undefined) {
      // All protocol RecordsWrites must go through protocol auth, because protocolPath, contextId, and record type must be validated
      await ProtocolAuthorization.authorize(tenant, this, newestRecordsWrite, messageStore);
    } else if (this.author !== undefined && this.authorSignaturePayload?.permissionsGrantId !== undefined) {
      await RecordsGrantAuthorization.authorizeRead(tenant, this, newestRecordsWrite, this.author, messageStore);
    } else {
      throw new Error('message failed authorization');
    }
  }
}
