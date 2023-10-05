import type { Signer } from '../types/signer.js';
import type { PermissionsGrantMessage, PermissionsRevokeDescriptor, PermissionsRevokeMessage } from '../types/permissions-types.js';

import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { validateMessageSignatureIntegrity } from '../core/auth.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';

export type PermissionsRevokeOptions = {
  messageTimestamp?: string;
  permissionsGrantId: string;
  authorizationSigner: Signer;
};

export class PermissionsRevoke extends Message<PermissionsRevokeMessage> {
  public static async parse(message: PermissionsRevokeMessage): Promise<PermissionsRevoke> {
    await validateMessageSignatureIntegrity(message.authorization.authorSignature, message.descriptor);

    return new PermissionsRevoke(message);
  }

  public static async create(options: PermissionsRevokeOptions): Promise<PermissionsRevoke> {
    const descriptor: PermissionsRevokeDescriptor = {
      interface          : DwnInterfaceName.Permissions,
      method             : DwnMethodName.Revoke,
      messageTimestamp   : options.messageTimestamp ?? getCurrentTimeInHighPrecision(),
      permissionsGrantId : options.permissionsGrantId,
    };

    const authorization = await Message.createAuthorizationAsAuthor(descriptor, options.authorizationSigner);
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