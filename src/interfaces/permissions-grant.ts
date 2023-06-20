import type { PermissionsRequest } from './permissions-request';
import type { SignatureInput } from '../types/jws-types';
import type { PermissionConditions, PermissionScope } from '../types/permissions-types';
import type { PermissionsGrantDescriptor, PermissionsGrantMessage } from '../types/permissions-types';

import { getCurrentTimeInHighPrecision } from '../utils/time';
import { DwnInterfaceName, DwnMethodName, Message } from '../core/message';

type PermissionsGrantOptions = {
  dateCreated?: string;
  description?: string;
  grantedTo: string;
  grantedBy: string;
  grantedFor: string;
  permissionsRequestId?: string;
  scope: PermissionScope;
  conditions?: PermissionConditions;
  authorizationSignatureInput: SignatureInput;
};

export class PermissionsGrant extends Message<PermissionsGrantMessage> {

  static async create(options: PermissionsGrantOptions): Promise<PermissionsGrant> {
    const descriptor: PermissionsGrantDescriptor = {
      interface   : DwnInterfaceName.Permissions,
      method      : DwnMethodName.Grant,
      dateCreated : options.dateCreated ?? getCurrentTimeInHighPrecision(),
      conditions  : options.conditions ?? {},
      description : options.description,
      grantedTo   : options.grantedTo,
      grantedBy   : options.grantedBy,
      grantedFor  : options.grantedFor,
      scope       : options.scope,
    };

    const authorization = await Message.signAsAuthorization(descriptor, options.authorizationSignatureInput);
    const message: PermissionsGrantMessage = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new PermissionsGrant(message);
  }

  /**
   * generates a PermissionsGrant using the provided PermissionsRequest
   * @param permissionsRequest
   * @param authorizationSignatureInput - the private key and additional signature material of the grantor
   */
  static async fromPermissionsRequest(
    permissionsRequest: PermissionsRequest,
    authorizationSignatureInput: SignatureInput,
  ): Promise<PermissionsGrant> {
    const descriptor = permissionsRequest.message.descriptor;
    return PermissionsGrant.create({
      description          : descriptor.description,
      grantedBy            : descriptor.grantedBy,
      grantedTo            : descriptor.grantedTo,
      grantedFor           : descriptor.grantedFor,
      permissionsRequestId : await Message.getCid(permissionsRequest.message),
      scope                : descriptor.scope,
      conditions           : descriptor.conditions,
      authorizationSignatureInput,
    });
  }
}