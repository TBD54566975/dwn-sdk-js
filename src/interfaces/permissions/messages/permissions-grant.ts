import type { PermissionsRequest } from './permissions-request';
import type { SignatureInput } from '../../../jose/jws/general/types';
import type { PermissionConditions, PermissionScope } from '../types';
import type { PermissionsGrantDescriptor, PermissionsGrantMessage } from '../types';

import { computeCid } from '../../../utils/cid';
import { getCurrentTimeInHighPrecision } from '../../../utils/time';
import { v4 as uuidv4 } from 'uuid';

import { DEFAULT_CONDITIONS } from './permissions-request';
import { DwnInterfaceName, DwnMethodName, Message } from '../../../core/message';

type PermissionsGrantOptions = {
  dateCreated?: string;
  conditions?: PermissionConditions;
  description: string;
  grantedTo: string;
  grantedBy: string;
  objectId?: string;
  permissionsRequestId?: string;
  scope: PermissionScope;
  authorizationSignatureInput: SignatureInput;
};

export class PermissionsGrant extends Message {
  readonly message: PermissionsGrantMessage; // a more specific type than the base type defined in parent class

  constructor(message: PermissionsGrantMessage) {
    super(message);
  }

  static async create(options: PermissionsGrantOptions): Promise<PermissionsGrant> {
    const { conditions } = options;
    const providedConditions = conditions ? conditions : {};
    const mergedConditions = { ...DEFAULT_CONDITIONS, ...providedConditions };

    const descriptor: PermissionsGrantDescriptor = {
      interface   : DwnInterfaceName.Permissions,
      method      : DwnMethodName.Grant,
      dateCreated : options.dateCreated ?? getCurrentTimeInHighPrecision(),
      conditions  : mergedConditions,
      description : options.description,
      grantedTo   : options.grantedTo,
      grantedBy   : options.grantedBy,
      objectId    : options.objectId ? options.objectId : uuidv4(),
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
   * @param conditionOverrides - any conditions that the grantor may want to override
   */
  static async fromPermissionsRequest(
    permissionsRequest: PermissionsRequest,
    authorizationSignatureInput: SignatureInput,
    conditionOverrides: Partial<PermissionConditions> = {}
  ): Promise<PermissionsGrant> {
    const conditions = { ...permissionsRequest.conditions, ...conditionOverrides };

    return PermissionsGrant.create({
      conditions           : conditions,
      description          : permissionsRequest.description,
      grantedBy            : permissionsRequest.grantedBy,
      grantedTo            : permissionsRequest.grantedTo,
      permissionsRequestId : permissionsRequest.id,
      scope                : permissionsRequest.scope,
      authorizationSignatureInput
    });
  }

  /**
   * delegates the permission to the DID provided
   * @param to - the DID of the grantee
   * @param authorizationSignatureInput - the private key and additional signature material of this permission's `grantedTo`
   * @throws {Error} - if the permission cannot be delegated
   */
  async delegate(to: string, authorizationSignatureInput: SignatureInput): Promise<PermissionsGrant> {
    // throw an exception if the permission cannot be delegated
    if (!this.conditions.delegation) {
      throw new Error('this permission cannot be delegated');
    }

    // `grantedBy` of the delegated permission will be `grantedTo` of the permission being delegated because the grantee is the delegator
    const delegatedGrant = await PermissionsGrant.create({
      conditions  : this.conditions,
      description : this.description,
      grantedBy   : this.grantedTo,
      grantedTo   : to,
      scope       : this.scope,
      authorizationSignatureInput
    });

    delegatedGrant.delegatedFrom = await computeCid(this.message);
    delegatedGrant.delegationChain = this.message;

    return delegatedGrant;
  }

  get id(): string {
    return this.message.descriptor.objectId;
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

  private set delegatedFrom(cid: string) {
    this.message.descriptor.delegatedFrom = cid;
  }

  private set delegationChain(parentGrant: PermissionsGrantMessage) {
    this.message.delegationChain = parentGrant;
  }
}