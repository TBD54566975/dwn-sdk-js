import type { KeyValues } from '../types/query-types.js';
import type { MessageStore } from '../types//message-store.js';
import type { Signer } from '../types/signer.js';
import type { RecordsDeleteDescriptor, RecordsDeleteMessage, RecordsWriteMessage } from '../types/records-types.js';

import { AbstractMessage } from '../core/abstract-message.js';
import { Message } from '../core/message.js';
import { PermissionGrant } from '../protocols/permission-grant.js';
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
   * Denotes if all the descendent records should be purged. Defaults to `false`.
   */
  prune?: boolean

  /**
   * The delegated grant to sign on behalf of the logical author, which is the grantor (`grantedBy`) of the delegated grant.
   */
  delegatedGrant?: RecordsWriteMessage;
};

export class RecordsDelete extends AbstractMessage<RecordsDeleteMessage> {

  public static async parse(message: RecordsDeleteMessage): Promise<RecordsDelete> {
    let signaturePayload;
    if (message.authorization !== undefined) {
      signaturePayload = await Message.validateSignatureStructure(message.authorization.signature, message.descriptor);
    }

    await Records.validateDelegatedGrantReferentialIntegrity(message, signaturePayload);

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
      messageTimestamp : options.messageTimestamp ?? currentTime,
      recordId,
      prune            : options.prune ?? false
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
    const { protocol, protocolPath, recipient, schema, parentId, dateCreated } = initialWrite.descriptor;

    // NOTE: the "trick" not may not be apparent on how a query is able to omit deleted records:
    // we intentionally not add index for `isLatestBaseState` at all, this means that upon a successful delete,
    // no messages with the record ID will match any query because queries by design filter by `isLatestBaseState = true`,
    // `isLatestBaseState` for the initial delete would have been toggled to `false`
    const indexes: { [key:string]: string | boolean | undefined } = {
      // isLatestBaseState : "true", // intentionally showing that this index is omitted
      protocol, protocolPath, recipient, schema, parentId, dateCreated,
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
    const delegatedGrant = await PermissionGrant.parse(this.message.authorization!.authorDelegatedGrant!);
    await RecordsGrantAuthorization.authorizeDelete({
      recordsDeleteMessage : this.message,
      recordsWriteToDelete,
      expectedGrantor      : this.author!,
      expectedGrantee      : this.signer!,
      permissionGrant      : delegatedGrant,
      messageStore
    });
  }
}
