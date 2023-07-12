import type { PermissionsRequest } from './permissions-request.js';
import type { SignatureInput } from '../types/jws-types.js';
import type { PermissionConditions, PermissionScope } from '../types/permissions-types.js';
import type { PermissionsGrantDescriptor, PermissionsGrantMessage } from '../types/permissions-types.js';

import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { validateAuthorizationIntegrity } from '../core/auth.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';

export type PermissionsGrantOptions = {
  messageTimestamp?: string;
  dateExpires: string;
  description?: string;
  grantedTo: string;
  grantedBy: string;
  grantedFor: string;
  permissionsRequestId?: string;
  scope: PermissionScope;
  conditions?: PermissionConditions;
  authorizationSignatureInput: SignatureInput;
};

export type CreateFromPermissionsRequestOverrides = {
  dateExpires: string;
  description?: string;
  grantedTo?: string;
  grantedBy?: string;
  grantedFor?: string;
  scope?: PermissionScope;
  conditions?: PermissionConditions;
};

export class PermissionsGrant extends Message<PermissionsGrantMessage> {

  public static async parse(message: PermissionsGrantMessage): Promise<PermissionsGrant> {
    await validateAuthorizationIntegrity(message);

    return new PermissionsGrant(message);
  }

  static async create(options: PermissionsGrantOptions): Promise<PermissionsGrant> {
    const descriptor: PermissionsGrantDescriptor = {
      interface            : DwnInterfaceName.Permissions,
      method               : DwnMethodName.Grant,
      messageTimestamp     : options.messageTimestamp ?? getCurrentTimeInHighPrecision(),
      dateExpires          : options.dateExpires,
      description          : options.description,
      grantedTo            : options.grantedTo,
      grantedBy            : options.grantedBy,
      grantedFor           : options.grantedFor,
      permissionsRequestId : options.permissionsRequestId,
      scope                : options.scope,
      conditions           : options.conditions,
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    const authorization = await Message.signAsAuthorization(descriptor, options.authorizationSignatureInput);
    const message: PermissionsGrantMessage = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new PermissionsGrant(message);
  }

  /**
   * generates a PermissionsGrant using the provided PermissionsRequest
   * @param permissionsRequest
   * @param authorizationSignatureInput - the private key and additional signature material of the grantor
   * @param overrides - overrides that will be used instead of the properties in `permissionsRequest`
   */
  public static async createFromPermissionsRequest(
    permissionsRequest: PermissionsRequest,
    authorizationSignatureInput: SignatureInput,
    overrides: CreateFromPermissionsRequestOverrides,
  ): Promise<PermissionsGrant> {
    const descriptor = permissionsRequest.message.descriptor;
    return PermissionsGrant.create({
      dateExpires          : overrides.dateExpires,
      description          : overrides.description ?? descriptor.description,
      grantedBy            : overrides.grantedBy ?? descriptor.grantedBy,
      grantedTo            : overrides.grantedTo ?? descriptor.grantedTo,
      grantedFor           : overrides.grantedFor ?? descriptor.grantedFor,
      permissionsRequestId : await Message.getCid(permissionsRequest.message),
      scope                : overrides.scope ?? descriptor.scope,
      conditions           : overrides.conditions ?? descriptor.conditions,
      authorizationSignatureInput,
    });
  }

  public authorize(): void {
    const { grantedBy, grantedFor } = this.message.descriptor;
    if (this.author !== grantedBy) {
      throw new DwnError(DwnErrorCode.PermissionsGrantGrantedByMismatch, 'Message author must match grantedBy property');
    } else if (grantedBy !== grantedFor) {
      // Without delegation, only the DWN owner may grant access to their own DWN.
      throw new DwnError(
        DwnErrorCode.PermissionsGrantUnauthorizedGrant,
        `${grantedBy} is not authorized to give access to the DWN belonging to ${grantedFor}`
      );
    }
  }
}
