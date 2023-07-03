import type { SignatureInput } from '../types/jws-types.js';
import type { PermissionConditions, PermissionScope } from '../types/permissions-types.js';
import type { PermissionsRequestDescriptor, PermissionsRequestMessage } from '../types/permissions-types.js';

import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { validateAuthorizationIntegrity } from '../core/auth.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';

export type PermissionsRequestOptions = {
  messageTimestamp?: string;
  description?: string;
  grantedTo: string;
  grantedBy: string;
  grantedFor: string;
  scope: PermissionScope;
  conditions?: PermissionConditions;
  authorizationSignatureInput: SignatureInput;
};

export class PermissionsRequest extends Message<PermissionsRequestMessage> {

  public static async parse(message: PermissionsRequestMessage): Promise<PermissionsRequest> {
    await validateAuthorizationIntegrity(message);

    return new PermissionsRequest(message);
  }

  public static async create(options: PermissionsRequestOptions): Promise<PermissionsRequest> {
    const descriptor: PermissionsRequestDescriptor = {
      interface        : DwnInterfaceName.Permissions,
      method           : DwnMethodName.Request,
      messageTimestamp : options.messageTimestamp ?? getCurrentTimeInHighPrecision(),
      description      : options.description,
      grantedTo        : options.grantedTo,
      grantedBy        : options.grantedBy,
      grantedFor       : options.grantedFor,
      scope            : options.scope,
      conditions       : options.conditions,
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    const auth = await Message.signAsAuthorization(descriptor, options.authorizationSignatureInput);
    const message: PermissionsRequestMessage = { descriptor, authorization: auth };

    Message.validateJsonSchema(message);

    return new PermissionsRequest(message);
  }
}
