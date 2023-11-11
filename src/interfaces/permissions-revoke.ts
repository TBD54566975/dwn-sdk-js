import type { Signer } from '../types/signer.js';
import type { PermissionsGrantMessage, PermissionsRevokeDescriptor, PermissionsRevokeMessage } from '../types/permissions-types.js';

import { AbstractMessage } from '../core/abstract-message.js';
import { Message } from '../core/message.js';
import { Time } from '../utils/time.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export type PermissionsRevokeOptions = {
  messageTimestamp?: string;
  permissionsGrantId: string;
  signer: Signer;
};

export class PermissionsRevoke extends AbstractMessage<PermissionsRevokeMessage> {
  public static async parse(message: PermissionsRevokeMessage): Promise<PermissionsRevoke> {
    await Message.validateMessageSignatureIntegrity(message.authorization.signature, message.descriptor);
    Time.validateTimestamp(message.descriptor.messageTimestamp);

    return new PermissionsRevoke(message);
  }

  public static async create(options: PermissionsRevokeOptions): Promise<PermissionsRevoke> {
    const descriptor: PermissionsRevokeDescriptor = {
      interface          : DwnInterfaceName.Permissions,
      method             : DwnMethodName.Revoke,
      messageTimestamp   : options.messageTimestamp ?? Time.getCurrentTimestamp(),
      permissionsGrantId : options.permissionsGrantId,
    };

    const authorization = await Message.createAuthorization({ descriptor, signer: options.signer });
    const message: PermissionsRevokeMessage = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new PermissionsRevoke(message);
  }

  public async authorize(permissionsGrantMessage: PermissionsGrantMessage): Promise<void> {
    if (this.author !== permissionsGrantMessage.descriptor.grantedFor) {
      // Until delegation is implemented, only the DWN owner may grant or revoke access to their DWN
      throw new DwnError(DwnErrorCode.PermissionsRevokeUnauthorizedRevoke, 'Only the DWN owner may revoke a grant');
    }
  }
}