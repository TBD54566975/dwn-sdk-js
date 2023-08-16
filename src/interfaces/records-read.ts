import type { MessageStore } from '../types/message-store.js';
import type { RecordsWrite } from './records-write.js';
import type { SignatureInput } from '../types/jws-types.js';
import type { Filter, GenericMessage } from '../types/message-types.js';
import type { RecordsReadDescriptor, RecordsReadMessage } from '../types/records-types.js';

import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { Message } from '../core/message.js';
import { ProtocolAuthorization } from '../core/protocol-authorization.js';
import { RecordsGrantAuthorization } from '../core/records-grant-authorization.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { validateAuthorizationIntegrity } from '../core/auth.js';
import { DwnError, DwnErrorCode } from '../index.js';
import { DwnInterfaceName, DwnMethodName } from '../core/message.js';

export type RecordsReadOptions = {
  recordId?: string;
  protocolPath?: string;
  protocol?: string;
  parentId?: string;
  date?: string;
  authorizationSignatureInput?: SignatureInput;
  permissionsGrantId?: string;
};

export class RecordsRead extends Message<RecordsReadMessage> {

  public static async parse(message: RecordsReadMessage): Promise<RecordsRead> {
    if (message.authorization !== undefined) {
      await validateAuthorizationIntegrity(message as GenericMessage);
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
    const { recordId, protocol, protocolPath, parentId, authorizationSignatureInput, permissionsGrantId } = options;
    const currentTime = getCurrentTimeInHighPrecision();

    const descriptor: RecordsReadDescriptor = {
      interface        : DwnInterfaceName.Records,
      method           : DwnMethodName.Read,
      recordId,
      protocol,
      protocolPath,
      parentId,
      messageTimestamp : options.date ?? currentTime
    };

    removeUndefinedProperties(descriptor);

    // only generate the `authorization` property if signature input is given
    let authorization = undefined;
    if (authorizationSignatureInput !== undefined) {
      authorization = await Message.signAsAuthorization(descriptor, authorizationSignatureInput, permissionsGrantId);
    }
    const message: RecordsReadMessage = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new RecordsRead(message);
  }

  /**
   * Creates a Records interface Filter using either the `recordId` or `protocol` & `protocolPath` of the incoming Message.
   * Also filters on an optional `parentId` for `protocolPath` based reads
   * @param descriptor message descriptor with optional properties `recordId`, `protocol` and `protocolPath`
   *
   * @returns {Filter} with a Records interface as well as the appropriate filter params
   * @throws {DwnError} if `recordId` or `protocol` and `protocolPath` are missing
   */
  public static createFilter(descriptor: Partial<Omit<RecordsReadDescriptor, 'method'>>): Filter {
    const filter: Filter = { interface: DwnInterfaceName.Records, isLatestBaseState: true };
    const { recordId, protocol, protocolPath, parentId } = descriptor;
    if (recordId !== undefined) {
      return { ...filter, recordId };
    } else if (protocol !== undefined && protocolPath !== undefined) {
      if (parentId !== undefined) {
        filter.parentId = parentId;
      }
      return { ...filter, protocol, protocolPath };
    } else {
      throw new DwnError(
        DwnErrorCode.RecordsReadMissingDescriptorProperties,
        'missing required properties from RecordsRead descriptor, expected `recordId` or `protocol` with `protocolPath`'
      );
    }
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
    } else if (this.author !== undefined && this.authorizationPayload?.permissionsGrantId !== undefined) {
      await RecordsGrantAuthorization.authorizeRead(tenant, this, newestRecordsWrite, this.author, messageStore);
    } else {
      throw new Error('message failed authorization');
    }
  }
}
