import type { SignatureInput } from '../../../jose/jws/general/types.js';
import type { PermissionConditions, PermissionScope } from '../types.js';
import type { PermissionsRequestDescriptor, PermissionsRequestMessage } from '../types.js';

import { getCurrentTimeInHighPrecision } from '../../../utils/time.js';
import { v4 as uuidv4 } from 'uuid';
import { validateAuthorizationIntegrity } from '../../../core/auth.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../../../core/message.js';

type PermissionsRequestOptions = {
  dateCreated?: string;
  conditions?: PermissionConditions;
  description: string;
  grantedTo: string;
  grantedBy: string;
  objectId?: string;
  scope: PermissionScope;
  authorizationSignatureInput: SignatureInput;
};

export class PermissionsRequest extends Message<PermissionsRequestMessage> {

  public static async parse(message: PermissionsRequestMessage): Promise<PermissionsRequest> {
    await validateAuthorizationIntegrity(message);

    return new PermissionsRequest(message);
  }

  public static async create(options: PermissionsRequestOptions): Promise<PermissionsRequest> {
    const { conditions } = options;
    const providedConditions = conditions ? conditions : {};
    const mergedConditions = { ...DEFAULT_CONDITIONS, ...providedConditions };

    const descriptor: PermissionsRequestDescriptor = {
      interface   : DwnInterfaceName.Permissions,
      method      : DwnMethodName.Request,
      dateCreated : options.dateCreated ?? getCurrentTimeInHighPrecision(),
      conditions  : mergedConditions,
      description : options.description,
      grantedTo   : options.grantedTo,
      grantedBy   : options.grantedBy,
      objectId    : options.objectId ? options.objectId : uuidv4(),
      scope       : options.scope,
    };

    Message.validateJsonSchema({ descriptor, authorization: { } });

    const auth = await Message.signAsAuthorization(descriptor, options.authorizationSignatureInput);
    const message: PermissionsRequestMessage = { descriptor, authorization: auth };

    return new PermissionsRequest(message);
  }

  get id(): string {
    return this.message.descriptor.objectId!;
  }

  get conditions(): PermissionConditions {
    return this.message.descriptor.conditions;
  }

  get grantedBy(): string {
    return this.message.descriptor.grantedBy;
  }

  get grantedTo(): string {
    return this.message.descriptor.grantedTo;
  }

  get description(): string {
    return this.message.descriptor.description;
  }

  get scope(): PermissionScope {
    return this.message.descriptor.scope;
  }
}

export const DEFAULT_CONDITIONS: PermissionConditions = {
  attestation  : 'optional',
  delegation   : false,
  encryption   : 'optional',
  publication  : false,
  sharedAccess : false
};