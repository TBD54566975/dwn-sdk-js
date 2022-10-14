import type { AuthCreateOptions, Authorizable, AuthVerificationResult } from '../../../core/types';
import type { PermissionsGrantDescriptor, PermissionsGrantMessage } from '../types';
import type { PermissionScope, PermissionConditions } from '../types';
import type { SignatureInput } from '../../../jose/jws/general/types';

import { CID } from 'multiformats/cid';
import { sign, verifyAuth } from '../../../core/auth';
import { DidResolver } from '../../../did/did-resolver';
import { generateCid } from '../../../utils/cid';
import { Message } from '../../../core/message';
import { MessageStore } from '../../../store/message-store';
import { PermissionsRequest, DEFAULT_CONDITIONS } from './permissions-request';
import { v4 as uuidv4 } from 'uuid';
import { validate } from '../../../validation/validator';

type PermissionsGrantOptions = AuthCreateOptions & {
  target: string,
  dateCreated?: number;
  conditions?: PermissionConditions;
  description: string;
  grantedTo: string;
  grantedBy: string;
  objectId?: string;
  permissionsRequestId?: string;
  scope: PermissionScope;
};

export class PermissionsGrant extends Message implements Authorizable {
  protected message: PermissionsGrantMessage;

  constructor(message: PermissionsGrantMessage) {
    super(message);
  }

  static async create(options: PermissionsGrantOptions): Promise<PermissionsGrant> {
    const { conditions } = options;
    const providedConditions = conditions ? conditions : {};
    const mergedConditions = { ...DEFAULT_CONDITIONS, ...providedConditions };

    const descriptor: PermissionsGrantDescriptor = {
      target      : options.target,
      dateCreated : options.dateCreated ?? Date.now(),
      conditions  : mergedConditions,
      description : options.description,
      grantedTo   : options.grantedTo,
      grantedBy   : options.grantedBy,
      method      : 'PermissionsGrant',
      objectId    : options.objectId ? options.objectId : uuidv4(),
      scope       : options.scope,
    };

    const messageType = descriptor.method;
    validate(messageType, { descriptor, authorization: {} });

    const auth = await sign({ descriptor }, options.signatureInput);
    const message: PermissionsGrantMessage = { descriptor, authorization: auth };

    return new PermissionsGrant(message);
  }


  /**
   * generates a PermissionsGrant using the provided PermissionsRequest
   * @param target - the DID of the DWN to this grant message will be sent to
   * @param permissionsRequest
   * @param signatureInput - the private key and additional signature material of the grantor
   * @param conditionOverrides - any conditions that the grantor may want to override
   */
  static async fromPermissionsRequest(
    target: string,
    permissionsRequest: PermissionsRequest,
    signatureInput: SignatureInput,
    conditionOverrides: Partial<PermissionConditions> = {}
  ): Promise<PermissionsGrant> {
    const conditions = { ...permissionsRequest.conditions, ...conditionOverrides };

    return PermissionsGrant.create({
      target,
      conditions           : conditions,
      description          : permissionsRequest.description,
      grantedBy            : permissionsRequest.grantedBy,
      grantedTo            : permissionsRequest.grantedTo,
      permissionsRequestId : permissionsRequest.id,
      scope                : permissionsRequest.scope,
      signatureInput       : signatureInput
    });
  }

  /**
   * delegates the permission to the DID provided
   * @param target - the DID of the DWN to this grant message will be sent to
   * @param to - the DID of the grantee
   * @param signatureInput - the private key and additional signature material of this permission's `grantedTo`
   * @throws {Error} - if the permission cannot be delegated
   */
  async delegate(target: string, to: string, signatureInput: SignatureInput): Promise<PermissionsGrant> {
    // throw an exception if the permission cannot be delegated
    if (!this.conditions.delegation) {
      throw new Error('this permission cannot be delegated');
    }

    // `grantedBy` of the delegated permission will be `grantedTo` of the permission being delegated because the grantee is the delegator
    const delegatedGrant = await PermissionsGrant.create({
      target,
      conditions     : this.conditions,
      description    : this.description,
      grantedBy      : this.grantedTo,
      grantedTo      : to,
      scope          : this.scope,
      signatureInput : signatureInput
    });

    delegatedGrant.delegatedFrom = await generateCid(this.message);
    delegatedGrant.delegationChain = this.message;

    return delegatedGrant;
  }

  verifyAuth(didResolver: DidResolver, messageStore: MessageStore): Promise<AuthVerificationResult> {
    return verifyAuth(this.message, didResolver, messageStore);
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

  private set delegatedFrom(cid: CID) {
    this.message.descriptor.delegatedFrom = cid.toString();
  }

  private set delegationChain(parentGrant: PermissionsGrantMessage) {
    this.message.delegationChain = parentGrant;
  }
}