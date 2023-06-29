import type { SignatureInput } from '../types/jws-types.js';
import type { PermissionsGrantMessage, PermissionsRevokeDescriptor, PermissionsRevokeMessage } from '../types/permissions-types.js';

import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { validateAuthorizationIntegrity } from '../core/auth.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';

export type PermissionsRevokeOptions = {
  dateCreated?: string;
  permissionsGrantId: string;
  authorizationSignatureInput: SignatureInput;
};

export class PermissionsRevoke extends Message<PermissionsRevokeMessage> {
  public static async parse(message: PermissionsRevokeMessage): Promise<PermissionsRevoke> {
    await validateAuthorizationIntegrity(message);

    return new PermissionsRevoke(message);
  }

  public static async create(options: PermissionsRevokeOptions): Promise<PermissionsRevoke> {
    const descriptor: PermissionsRevokeDescriptor = {
      interface          : DwnInterfaceName.Permissions,
      method             : DwnMethodName.Revoke,
      dateCreated        : options.dateCreated ?? getCurrentTimeInHighPrecision(),
      permissionsGrantId : options.permissionsGrantId,
    };

    const authorization = await Message.signAsAuthorization(descriptor, options.authorizationSignatureInput);
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

  /**
   * @returns oldest PermissionsRevokeMessage in the array. `undefined` if given array is empty.
   */
  public static async getOldestRevoke(permissionsRevokeMessages: PermissionsRevokeMessage[]): Promise<PermissionsRevokeMessage | undefined> {
    // TODO: #406 - Deduplicate code with Message.getNewestMessage (https://github.com/TBD54566975/dwn-sdk-js/issues/406)
    let currentOldestMessage: PermissionsRevokeMessage | undefined = undefined;
    for (const message of permissionsRevokeMessages) {
      if (currentOldestMessage === undefined || await PermissionsRevoke.isCreatedOlder(message, currentOldestMessage)) {
        currentOldestMessage = message;
      }
    }

    return currentOldestMessage;
  }

  /**
   * Checks if first message is older than second message.
   * @returns `true` if `a` is older than `b`; `false` otherwise
   */
  public static async isCreatedOlder(a: PermissionsRevokeMessage, b: PermissionsRevokeMessage): Promise<boolean> {
    // TODO: #406 - Deduplicate code with Message.isOlder (https://github.com/TBD54566975/dwn-sdk-js/issues/406)
    const aIsNewer = (await PermissionsRevoke.compareCreatedTime(a, b) > 0);
    return aIsNewer;
  }

  /**
   * Compare `dateCreated` time for two PermissionsRevokeMessages, using message CID as a tiebreaker if the timestamps are equal
   * @returns 1 if `a` is larger/newer than `b`; -1 if `a` is smaller/older than `b`; 0 otherwise (same age)
   */
  public static async compareCreatedTime(a: PermissionsRevokeMessage, b: PermissionsRevokeMessage): Promise<number> {
    // TODO: #406 - Deduplicate code with Message.compareModifiedTime (https://github.com/TBD54566975/dwn-sdk-js/issues/406)
    if (a.descriptor.dateCreated > b.descriptor.dateCreated) {
      return 1;
    } else if (a.descriptor.dateCreated < b.descriptor.dateCreated) {
      return -1;
    }

    // else `dateCreated` is the same between a and b
    // compare the CID of the message instead, the < and > operators compare strings in lexicographical order
    return Message.compareCid(a, b);
  }
}