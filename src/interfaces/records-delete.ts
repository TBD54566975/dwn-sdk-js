import type { DelegatedGrantMessage } from '../types/delegated-grant-message.js';
import type { GenericMessage } from '../index.js';
import type { KeyValues } from '../types/query-types.js';
import type { MessageStore } from '../types//message-store.js';
import type { Signer } from '../types/signer.js';
import type { RecordsDeleteDescriptor, RecordsDeleteMessage, RecordsWriteMessage } from '../types/records-types.js';

import { AbstractMessage } from '../core/abstract-message.js';
import { Message } from '../core/message.js';
import { Records } from '../utils/records.js';
import { RecordsGrantAuthorization } from '../core/records-grant-authorization.js';
import { removeUndefinedProperties } from '../utils/object.js';
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
      signaturePayload = await Message.validateSignatureStructure(message.authorization.signature, message.descriptor);
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

  /**
   * Indexed properties needed for MessageStore indexing.
   */
  public constructIndexes(
    initialWrite: RecordsWriteMessage,
  ): KeyValues {
    const message = this.message;
    const descriptor = { ...message.descriptor };

    // we add the immutable properties from the initial RecordsWrite message in order to use them when querying relevant deletes.
    const { protocol, protocolPath, recipient, schema, parentId, dataFormat, dateCreated } = initialWrite.descriptor;

    // NOTE: the "trick" not may not be apparent on how a query is able to omit deleted records:
    // we intentionally not add index for `isLatestBaseState` at all, this means that upon a successful delete,
    // no messages with the record ID will match any query because queries by design filter by `isLatestBaseState = true`,
    // `isLatestBaseState` for the initial delete would have been toggled to `false`
    const indexes: { [key:string]: string | boolean | undefined } = {
      // isLatestBaseState : "true", // intentionally showing that this index is omitted
      protocol, protocolPath, recipient, schema, parentId, dataFormat, dateCreated,
      contextId : initialWrite.contextId,
      author    : this.author!,
      ...descriptor
    };
    removeUndefinedProperties(indexes);

    return indexes as KeyValues;
  }

  /*
   * Authorizes the delegate who signed the message.
   * @param messageStore Used to check if the grant has been revoked.
   */
  public async authorizeDelegate(recordsWriteToDelete: RecordsWriteMessage, messageStore: MessageStore): Promise<void> {
    const delegatedGrantMessage = this.message.authorization!.authorDelegatedGrant!;
    await RecordsGrantAuthorization.authorizeDelete({
      recordsDeleteMessage      : this.message,
      recordsWriteToDelete,
      expectedGrantedToInGrant  : this.signer!,
      expectedGrantedForInGrant : this.author!,
      permissionsGrantMessage   : delegatedGrantMessage,
      messageStore
    });
  }

  public static isRecordsDeleteMessage(message: GenericMessage): message is RecordsWriteMessage {
    return message.descriptor.interface === DwnInterfaceName.Records &&
      message.descriptor.method === DwnMethodName.Delete;
  }
}
