import type { Signer } from '../types/signer.js';
import type { PermissionConditions, PermissionScope } from '../types/permissions-grant-descriptor.js';
import type { PermissionsRequestDescriptor, PermissionsRequestMessage } from '../types/permissions-types.js';

import { AbstractMessage } from '../core/abstract-message.js';
import { Message } from '../core/message.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { Time } from '../utils/time.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

export type PermissionsRequestOptions = {
  messageTimestamp?: string;
  description?: string;
  grantedTo: string;
  grantedBy: string;
  grantedFor: string;
  scope: PermissionScope;
  conditions?: PermissionConditions;
  signer: Signer;
};

export class PermissionsRequest extends AbstractMessage<PermissionsRequestMessage> {

  public static async parse(message: PermissionsRequestMessage): Promise<PermissionsRequest> {
    await Message.validateMessageSignatureIntegrity(message.authorization.signature, message.descriptor);
    Time.validateTimestamp(message.descriptor.messageTimestamp);

    return new PermissionsRequest(message);
  }

  public static async create(options: PermissionsRequestOptions): Promise<PermissionsRequest> {
    const descriptor: PermissionsRequestDescriptor = {
      interface        : DwnInterfaceName.Permissions,
      method           : DwnMethodName.Request,
      messageTimestamp : options.messageTimestamp ?? Time.getCurrentTimestamp(),
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

    const auth = await Message.createAuthorization({ descriptor, signer: options.signer });
    const message: PermissionsRequestMessage = { descriptor, authorization: auth };

    Message.validateJsonSchema(message);

    return new PermissionsRequest(message);
  }
}
