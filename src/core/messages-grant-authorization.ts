import type { GenericMessage } from '../types/message-types.js';
import type { MessagesPermissionScope } from '../types/permission-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { PermissionGrant } from '../protocols/permission-grant.js';
import type { ProtocolsConfigureMessage } from '../types/protocols-types.js';
import type { DataEncodedRecordsWriteMessage, RecordsDeleteMessage, RecordsWriteMessage } from '../types/records-types.js';
import type { MessagesQueryMessage, MessagesReadMessage, MessagesSubscribeMessage } from '../types/messages-types.js';

import { DwnInterfaceName } from '../enums/dwn-interface-method.js';
import { GrantAuthorization } from './grant-authorization.js';
import { PermissionsProtocol } from '../protocols/permissions.js';
import { Records } from '../utils/records.js';
import { RecordsWrite } from '../interfaces/records-write.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';

export class MessagesGrantAuthorization {

  /**
   * Authorizes a MessagesReadMessage using the given permission grant.
   * @param messageStore Used to check if the given grant has been revoked; and to fetch related RecordsWrites if needed.
   */
  public static async authorizeMessagesRead(input: {
    messagesReadMessage: MessagesReadMessage,
    messageToRead: GenericMessage,
    expectedGrantor: string,
    expectedGrantee: string,
    permissionGrant: PermissionGrant,
    messageStore: MessageStore,
  }): Promise<void> {
    const {
      messagesReadMessage, messageToRead, expectedGrantor, expectedGrantee, permissionGrant, messageStore
    } = input;

    await GrantAuthorization.performBaseValidation({
      incomingMessage: messagesReadMessage,
      expectedGrantor,
      expectedGrantee,
      permissionGrant,
      messageStore
    });

    const scope = permissionGrant.scope as MessagesPermissionScope;
    await MessagesGrantAuthorization.verifyScope(expectedGrantor, messageToRead, scope, messageStore);
  }

  /**
   * Authorizes the scope of a permission grant for MessagesQuery or MessagesSubscribe.
   * @param messageStore Used to check if the grant has been revoked.
   */
  public static async authorizeQueryOrSubscribe(input: {
    incomingMessage: MessagesQueryMessage | MessagesSubscribeMessage,
    expectedGrantor: string,
    expectedGrantee: string,
    permissionGrant: PermissionGrant,
    messageStore: MessageStore,
  }): Promise<void> {
    const {
      incomingMessage, expectedGrantor, expectedGrantee, permissionGrant, messageStore
    } = input;

    await GrantAuthorization.performBaseValidation({
      incomingMessage,
      expectedGrantor,
      expectedGrantee,
      permissionGrant,
      messageStore
    });

    // if the grant is scoped to a specific protocol, ensure that all of the query filters must include that protocol
    if (PermissionsProtocol.hasProtocolScope(permissionGrant.scope)) {
      const scopedProtocol = permissionGrant.scope.protocol;
      for (const filter of incomingMessage.descriptor.filters) {
        if (filter.protocol !== scopedProtocol) {
          throw new DwnError(
            DwnErrorCode.MessagesGrantAuthorizationMismatchedProtocol,
            `The protocol ${filter.protocol} does not match the scoped protocol ${scopedProtocol}`
          );
        }
      }
    }
  }

  /**
   * Verifies the given record against the scope of the given grant.
   */
  private static async verifyScope(
    tenant: string,
    messageToGet: GenericMessage,
    incomingScope: MessagesPermissionScope,
    messageStore: MessageStore,
  ): Promise<void> {
    if (incomingScope.protocol === undefined) {
      // if no protocol is specified in the scope, then the grant is for all records
      return;
    }

    if (messageToGet.descriptor.interface === DwnInterfaceName.Records) {
      // if the message is a Records interface message, get the RecordsWrite message associated with the record
      const recordsMessage = messageToGet as RecordsWriteMessage | RecordsDeleteMessage;
      const recordsWriteMessage = Records.isRecordsWrite(recordsMessage) ? recordsMessage :
        await RecordsWrite.fetchNewestRecordsWrite(messageStore, tenant, recordsMessage.descriptor.recordId);

      if (recordsWriteMessage.descriptor.protocol === incomingScope.protocol) {
        // the record protocol matches the incoming scope protocol
        return;
      }

      // we check if the protocol is the internal PermissionsProtocol for further validation
      if (recordsWriteMessage.descriptor.protocol === PermissionsProtocol.uri) {
        // get the permission scope from the permission message
        const permissionScope = await PermissionsProtocol.getScopeFromPermissionRecord(
          tenant,
          messageStore,
          recordsWriteMessage as DataEncodedRecordsWriteMessage
        );

        if (PermissionsProtocol.hasProtocolScope(permissionScope) && permissionScope.protocol === incomingScope.protocol) {
          // the permissions record scoped protocol matches the incoming scope protocol
          return;
        }
      }
    } else if (messageToGet.descriptor.interface === DwnInterfaceName.Protocols) {
      // if the message is a protocol message, it must be a `ProtocolConfigure` message
      const protocolsConfigureMessage = messageToGet as ProtocolsConfigureMessage;
      const configureProtocol = protocolsConfigureMessage.descriptor.definition.protocol;
      if (configureProtocol === incomingScope.protocol) {
        // the configured protocol matches the incoming scope protocol
        return;
      }
    }

    throw new DwnError(DwnErrorCode.MessagesReadVerifyScopeFailed, 'record message failed scope authorization');
  }
}