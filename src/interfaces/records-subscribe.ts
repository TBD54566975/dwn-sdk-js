import type { MessageStore } from '../types/message-store.js';
import type { Signer } from '../types/signer.js';
import type { RecordsFilter, RecordsSubscribeDescriptor, RecordsSubscribeMessage, RecordsWriteMessage } from '../types/records-types.js';

import { AbstractMessage } from '../core/abstract-message.js';
import { Message } from '../core/message.js';
import { PermissionGrant } from '../protocols/permission-grant.js';
import { Records } from '../utils/records.js';
import { RecordsGrantAuthorization } from '../core/records-grant-authorization.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { Time } from '../utils/time.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';
import { validateProtocolUrlNormalized, validateSchemaUrlNormalized } from '../utils/url.js';

export type RecordsSubscribeOptions = {
  messageTimestamp?: string;
  filter: RecordsFilter;
  signer?: Signer;
  protocolRole?: string;

  /**
   * The delegated grant to sign on behalf of the logical author, which is the grantor (`grantedBy`) of the delegated grant.
   */
  delegatedGrant?: RecordsWriteMessage;
};

/**
 * A class representing a RecordsSubscribe DWN message.
 */
export class RecordsSubscribe extends AbstractMessage<RecordsSubscribeMessage> {

  public static async parse(message: RecordsSubscribeMessage): Promise<RecordsSubscribe> {
    let signaturePayload;
    if (message.authorization !== undefined) {
      signaturePayload = await Message.validateSignatureStructure(message.authorization.signature, message.descriptor);
    }

    await Records.validateDelegatedGrantReferentialIntegrity(message, signaturePayload);

    if (signaturePayload?.protocolRole !== undefined) {
      if (message.descriptor.filter.protocolPath === undefined) {
        throw new DwnError(
          DwnErrorCode.RecordsSubscribeFilterMissingRequiredProperties,
          'Role-authorized subscriptions must include `protocolPath` in the filter'
        );
      }
    }
    if (message.descriptor.filter.protocol !== undefined) {
      validateProtocolUrlNormalized(message.descriptor.filter.protocol);
    }
    if (message.descriptor.filter.schema !== undefined) {
      validateSchemaUrlNormalized(message.descriptor.filter.schema);
    }
    Time.validateTimestamp(message.descriptor.messageTimestamp);

    return new RecordsSubscribe(message);
  }

  public static async create(options: RecordsSubscribeOptions): Promise<RecordsSubscribe> {
    const descriptor: RecordsSubscribeDescriptor = {
      interface        : DwnInterfaceName.Records,
      method           : DwnMethodName.Subscribe,
      messageTimestamp : options.messageTimestamp ?? Time.getCurrentTimestamp(),
      filter           : Records.normalizeFilter(options.filter),
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    // only generate the `authorization` property if signature input is given
    const signer = options.signer;
    let authorization;
    if (signer) {
      authorization = await Message.createAuthorization({
        descriptor,
        signer,
        protocolRole   : options.protocolRole,
        delegatedGrant : options.delegatedGrant
      });
    }
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new RecordsSubscribe(message);
  }

  /**
 * Authorizes the delegate who signed the message.
 * @param messageStore Used to check if the grant has been revoked.
 */
  public async authorizeDelegate(messageStore: MessageStore): Promise<void> {
    const delegatedGrant = await PermissionGrant.parse(this.message.authorization!.authorDelegatedGrant!);
    await RecordsGrantAuthorization.authorizeQueryOrSubscribe({
      incomingMessage : this.message,
      expectedGrantor : this.author!,
      expectedGrantee : this.signer!,
      permissionGrant : delegatedGrant,
      messageStore
    });
  }
}
